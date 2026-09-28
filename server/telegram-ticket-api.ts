/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/restrict-plus-operands */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Env, TelegramTicketRecord } from "../src/types";
import { discordRest, sendChannelMessage } from "../src/discord/rest";
import { getStaffRoleId } from "../src/config/roles";
import { issueExternalWarning } from "../src/handlers/warnings";

const PREFIX = "telegram-ticket:";
const MAX_BODY = 32 * 1024;
const field = (data: Record<string, unknown>, name: string, fallback = ""): string => typeof data[name] === "string" ? data[name] : fallback;
const configuredIds = (name: string): Set<string> => new Set((process.env[name] ?? "").split(",").map(value => value.trim()).filter(value => /^\d+$/.test(value)));
const ownerIds = configuredIds("TELEGRAM_TICKET_OWNER_IDS");
const recruiterIds = configuredIds("TELEGRAM_TICKET_RECRUITER_IDS");
const isOwner = (id: string): boolean => ownerIds.has(id);
const canReview = (id: string): boolean => isOwner(id) || recruiterIds.has(id);

function authorized(request: IncomingMessage, token: string): boolean {
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(supplied); const b = Buffer.from(token);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += value.length; if (size > MAX_BODY) throw new Error("Body too large"); chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

async function listTickets(env: Env): Promise<TelegramTicketRecord[]> {
  const output: TelegramTicketRecord[] = []; let cursor: string | undefined;
  do {
    const page = await env.APPLICATIONS.list({ prefix: PREFIX, ...(cursor ? { cursor } : {}) });
    for (const key of page.keys) {
      const ticket = await env.APPLICATIONS.get<TelegramTicketRecord>(key.name, "json");
      if (ticket) output.push(ticket);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return output.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function createTicket(env: Env, data: Record<string, unknown>): Promise<TelegramTicketRecord> {
  const telegramUserId = field(data, "telegramUserId");
  const telegramUsername = field(data, "telegramUsername").trim().slice(0, 64) || "без username";
  const discordUserId = field(data, "discordUserId").trim();
  const description = field(data, "description").trim();
  if (!/^\d{3,20}$/.test(telegramUserId) || description.length < 5 || description.length > 3000) throw new Error("Invalid ticket data");
  if (discordUserId && !/^\d{17,20}$/.test(discordUserId)) throw new Error("Invalid Discord ID");
  const staffRole = getStaffRoleId(env.STAFF_ROLE_ID);
  const allow = (1024n | 2048n | 8192n | 16384n | 32768n | 65536n).toString();
  const channel = await discordRest<{ id: string }>(env, `/guilds/${env.DISCORD_GUILD_ID}/channels`, { method: "POST", body: JSON.stringify({
    name: `tg-${telegramUsername.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 70) || telegramUserId}`,
    type: 0, parent_id: env.TICKETS_CATEGORY_ID, topic: `Rusticket Telegram | tg=${telegramUserId}${discordUserId ? ` | discord=${discordUserId}` : ""}`,
    permission_overwrites: [
      { id: env.DISCORD_GUILD_ID, type: 0, allow: "0", deny: "1024" },
      { id: staffRole, type: 0, allow, deny: "0" },
      { id: env.DISCORD_APPLICATION_ID, type: 1, allow, deny: "0" }
    ]
  }) });
  try {
    const id = randomUUID();
    const message = await sendChannelMessage(env, channel.id, {
      content: `<@&${staffRole}>`,
      embeds: [{ title: "🎫 Новый тикет из Telegram", color: 0x2aabee, fields: [
        { name: "Telegram", value: `@${telegramUsername}\nID: \`${telegramUserId}\`` },
        { name: "Discord", value: discordUserId ? `<@${discordUserId}> (\`${discordUserId}\`)` : "Не указан" },
        { name: "Обращение", value: description }
      ], footer: { text: `Источник: Telegram · ${id}` }, timestamp: new Date().toISOString() }],
      allowed_mentions: { roles: [staffRole], users: discordUserId ? [discordUserId] : [] }
    });
    const ticket: TelegramTicketRecord = { id, telegramUserId, telegramUsername, ...(discordUserId ? { discordUserId } : {}), description, ticketChannelId: channel.id, cardMessageId: message.id, status: "PENDING", createdAt: new Date().toISOString() };
    await env.APPLICATIONS.put(`${PREFIX}${id}`, JSON.stringify(ticket));
    return ticket;
  } catch (error) {
    await discordRest(env, `/channels/${channel.id}`, { method: "DELETE" }).catch(() => undefined); throw error;
  }
}

export async function handleTelegramTicketApi(request: IncomingMessage, response: ServerResponse, env: Env): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/internal/telegram-tickets")) return false;
  const token = process.env.TELEGRAM_TICKET_API_TOKEN?.trim();
  if (!token || !authorized(request, token)) { json(response, 401, { error: "unauthorized" }); return true; }
  try {
    if (request.method === "GET" && url.pathname === "/internal/telegram-tickets") {
      if (!canReview(request.headers["x-telegram-actor-id"]?.toString() ?? "")) { json(response, 403, { error: "forbidden" }); return true; }
      const status = url.searchParams.get("status");
      const tickets = (await listTickets(env)).filter(ticket => !status || ticket.status === status).slice(0, 50);
      json(response, 200, { tickets }); return true;
    }
    if (request.method === "POST" && url.pathname === "/internal/telegram-tickets") {
      json(response, 201, { ticket: await createTicket(env, await body(request)) }); return true;
    }
    const decision = /^\/internal\/telegram-tickets\/([0-9a-f-]+)\/(accept|reject)$/.exec(url.pathname);
    if (request.method === "POST" && decision) {
      const data = await body(request); const key = `${PREFIX}${decision[1]}`;
      const actorId = field(data, "actorTelegramId");
      if (!canReview(actorId) || (decision[2] === "reject" && !isOwner(actorId))) { json(response, 403, { error: "forbidden" }); return true; }
      const ticket = await env.APPLICATIONS.get<TelegramTicketRecord>(key, "json");
      if (!ticket) { json(response, 404, { error: "not_found" }); return true; }
      if (ticket.status !== "PENDING") { json(response, 409, { error: "already_decided" }); return true; }
      ticket.status = decision[2] === "accept" ? "ACCEPTED" : "REJECTED";
      ticket.decidedAt = new Date().toISOString(); ticket.decidedByTelegramId = actorId;
      if (ticket.status === "REJECTED") ticket.rejectionReason = field(data, "reason", "Без указания причины").slice(0, 1000);
      await env.APPLICATIONS.put(key, JSON.stringify(ticket));
      await sendChannelMessage(env, ticket.ticketChannelId, { content: ticket.status === "ACCEPTED" ? "✅ Тикет принят через Telegram." : `❌ Тикет отклонён через Telegram.\nПричина: ${ticket.rejectionReason}` });
      json(response, 200, { ticket }); return true;
    }
    if (request.method === "POST" && url.pathname === "/internal/telegram-tickets/warn") {
      const data = await body(request); const userId = field(data, "discordUserId"); const reason = field(data, "reason");
      if (!isOwner(field(data, "actorTelegramId"))) { json(response, 403, { error: "forbidden" }); return true; }
      const result = await issueExternalWarning(env, userId, `telegram:${field(data, "actorTelegramId", "unknown")}`, reason);
      json(response, result ? 200 : 409, result ? { warning: result } : { error: "warning_limit" }); return true;
    }
    json(response, 404, { error: "not_found" }); return true;
  } catch (error) {
    console.error("Telegram ticket API failed:", error instanceof Error ? error.message : "unknown");
    json(response, 400, { error: error instanceof Error ? error.message : "request_failed" }); return true;
  }
}
