/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/restrict-plus-operands */
import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { Env, TelegramTicketRecord } from "../src/types";
import { sendChannelMessage } from "../src/discord/rest";
import { issueExternalWarning } from "../src/handlers/warnings";
import { createTelegramApplication } from './telegram-application';
import { getApplicationByChannel, saveApplication } from '../src/storage/applications';
import { acceptApplicationRecord } from '../src/handlers/staffActions';
import { applicationEmbed, staffButtons } from '../src/discord/components';
import { discordRest } from '../src/discord/rest';

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
      if (ticket) {
        const application=await getApplicationByChannel(env,ticket.ticketChannelId);
        if(application) ticket.status=application.status;
        output.push(ticket);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return output.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
      json(response, 201, { ticket: await createTelegramApplication(env, await body(request)) }); return true;
    }
    const decision = /^\/internal\/telegram-tickets\/([0-9a-f-]+)\/(accept|reject)$/.exec(url.pathname);
    if (request.method === "POST" && decision) {
      const data = await body(request); const key = `${PREFIX}${decision[1]}`;
      const actorId = field(data, "actorTelegramId");
      if (!canReview(actorId) || (decision[2] === "reject" && !isOwner(actorId))) { json(response, 403, { error: "forbidden" }); return true; }
      const ticket = await env.APPLICATIONS.get<TelegramTicketRecord>(key, "json");
      if (!ticket) { json(response, 404, { error: "not_found" }); return true; }
      const application=await getApplicationByChannel(env,ticket.ticketChannelId);
      if(application) ticket.status=application.status;
      if (ticket.status !== "PENDING") { json(response, 409, { error: "already_decided" }); return true; }
      if(application) {
        if(decision[2]==='accept') await acceptApplicationRecord(env,application,env.DISCORD_APPLICATION_ID);
        else {
          const reason=field(data,'reason').trim();
          if(reason.length<2||reason.length>1000) {json(response,400,{error:'Причина: от 2 до 1000 символов.'});return true;}
          application.status='REJECTED'; application.staffId=env.DISCORD_APPLICATION_ID;
          application.rejectionReason=reason; application.decidedAt=new Date().toISOString();
          await saveApplication(env,application);
          await discordRest(env,`/channels/${application.ticketChannelId}/messages/${application.cardMessageId}`,{method:'PATCH',body:JSON.stringify({embeds:[applicationEmbed(application)],components:staffButtons(true)})});
        }
      }
      ticket.status = decision[2] === "accept" ? "ACCEPTED" : "REJECTED";
      ticket.decidedAt = new Date().toISOString(); ticket.decidedByTelegramId = actorId;
      if (ticket.status === "REJECTED") ticket.rejectionReason = field(data, "reason", "Без указания причины").slice(0, 1000);
      await env.APPLICATIONS.put(key, JSON.stringify(ticket));
      await sendChannelMessage(env, ticket.ticketChannelId, { content: (ticket.status === "ACCEPTED" ? "✅ Тикет принят через Telegram." : `❌ Тикет отклонён через Telegram.\nПричина: ${ticket.rejectionReason}`)+`\nTelegram ID модератора: ${actorId}`, allowed_mentions:{parse:[]} });
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
