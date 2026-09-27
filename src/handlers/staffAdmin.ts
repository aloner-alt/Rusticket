import { InteractionResponseType, ephemeral, jsonResponse } from "../discord/interactions";
import { isAdministrator } from "../discord/permissions";
import { discordRest, sendChannelMessage } from "../discord/rest";
import type { DiscordInteraction, Env, StaffBanRequest } from "../types";
import { interactionUser, modalValue } from "./helpers";

const PANEL_KEY = "staff-admin:panel-message-id";
const PANEL_DEDUPE_KEY = "staff-admin:panel-dedupe:2026-09-27-v1";
const REQUEST_PREFIX = "staff-ban-request:";
const ACTIVE_PREFIX = "staff-ban-active:";
const memo = `Staff следит за порядком, помогает участникам и действует спокойно даже во время конфликта.

**Основные обязанности**
• отвечать участникам и помогать с вопросами;
• следить за чатами, тикетами и соблюдением правил;
• останавливать конфликты без оскорблений и провокаций;
• фиксировать нарушения и указывать понятную причину наказания;
• перед серьёзным наказанием проверять контекст и доказательства.

**Запрещено**
• использовать права в личных целях;
• наказывать без причины или доказательств;
• выдавать поблажки друзьям;
• оскорблять участников или провоцировать конфликт;
• разглашать информацию из закрытых Staff-каналов;
• снимать наказание другого Staff без объяснения.

**Порядок действий**
1. Проверьте контекст и доказательства.
2. За небольшое нарушение сначала предупредите.
3. За повторное или серьёзное нарушение оформите наказание.
4. Всегда указывайте точную причину.
5. Спорные случаи передавайте старшей администрации.

Злоупотребление полномочиями может привести к предупреждению или снятию роли.`;

function isStaff(i: DiscordInteraction, env: Env): boolean {
  return i.guild_id === env.DISCORD_GUILD_ID && (isAdministrator(i) || Boolean(i.member?.roles.includes(env.STAFF_APPLICATION_ROLE_ID)));
}

export async function ensureStaffAdminPanel(env: Env): Promise<void> {
  if (!(await env.APPLICATIONS.get(PANEL_DEDUPE_KEY))) {
    type ChannelMessage = { id: string; author?: { id: string }; components?: Array<{ components?: Array<{ custom_id?: string }> }> };
    const messages = await discordRest<ChannelMessage[]>(env, `/channels/${env.STAFF_APPLICATION_CHANNEL_ID}/messages?limit=100`).catch(() => []);
    const panels = messages.filter(message => message.author?.id === env.DISCORD_APPLICATION_ID &&
      message.components?.some(row => row.components?.some(component => component.custom_id === "staff-admin:ban")));
    const keep = panels[0];
    if (keep) {
      await Promise.all(panels.slice(1).map(message => discordRest(env, `/channels/${env.STAFF_APPLICATION_CHANNEL_ID}/messages/${message.id}`, { method: "DELETE" }).catch(() => undefined)));
      await env.APPLICATIONS.put(PANEL_KEY, keep.id);
    }
    await env.APPLICATIONS.put(PANEL_DEDUPE_KEY, "done");
  }
  const old = await env.APPLICATIONS.get(PANEL_KEY);
  if (old) {
    const exists = await discordRest(env, `/channels/${env.STAFF_APPLICATION_CHANNEL_ID}/messages/${old}`).then(() => true).catch(() => false);
    if (exists) return;
  }
  const message = await sendChannelMessage(env, env.STAFF_APPLICATION_CHANNEL_ID, {
    embeds: [{ title: "🛡️ Admin Panel Staff", description: "Памятка для Discord Staff и запросы на бан.\n\nStaff оформляет запрос, а бан выполняется только после подтверждения пользователя с правом **Administrator**.", color: 0x5865f2 }],
    components: [{ type: 1, components: [
      { type: 2, style: 4, label: "Запросить бан", custom_id: "staff-admin:ban", emoji: { name: "⛔" } },
      { type: 2, style: 2, label: "Памятка", custom_id: "staff-admin:memo", emoji: { name: "📖" } }
    ] }]
  });
  await env.APPLICATIONS.put(PANEL_KEY, message.id);
}

export function showStaffMemo(i: DiscordInteraction, env: Env): Response {
  if (!isStaff(i, env)) return ephemeral("❌ Панель доступна только Discord Staff.");
  return jsonResponse({ type: InteractionResponseType.ChannelMessageWithSource, data: { embeds: [{ title: "📖 Памятка Discord Staff .int", description: memo, color: 0x3498db }], flags: 64 } });
}

export function openStaffBanUser(i: DiscordInteraction, env: Env): Response {
  if (!isStaff(i, env)) return ephemeral("❌ Запрос на бан доступен только Discord Staff.");
  return jsonResponse({ type: InteractionResponseType.ChannelMessageWithSource, data: { content: "Выберите участника, на которого нужно оформить запрос:", components: [{ type: 1, components: [{ type: 5, custom_id: "staff-admin:ban-user", placeholder: "Выберите участника", min_values: 1, max_values: 1 }] }], flags: 64 } });
}

export function openStaffBanModal(i: DiscordInteraction, env: Env): Response {
  if (!isStaff(i, env)) return ephemeral("❌ Недостаточно прав.");
  const userId = i.data?.values?.[0];
  if (!userId) return ephemeral("❌ Участник не выбран.");
  return jsonResponse({ type: InteractionResponseType.Modal, data: { title: "Запрос на бан", custom_id: `staff-admin:ban-modal:${userId}`, components: [
    { type: 1, components: [{ type: 4, custom_id: "duration", label: "Срок", style: 1, required: true, placeholder: "1h, 12h, 1d, 7d или навсегда", max_length: 20 }] },
    { type: 1, components: [{ type: 4, custom_id: "reason", label: "Причина и доказательства", style: 2, required: true, min_length: 5, max_length: 1000 }] }
  ] } });
}

function parseDuration(value: string): number | undefined | null {
  const v = value.trim().toLowerCase();
  if (["навсегда", "permanent", "perm", "forever"].includes(v)) return undefined;
  const match = /^(\d{1,3})\s*([hd])$/.exec(v);
  if (!match) return null;
  const amount = Number(match[1]);
  const duration = amount * (match[2] === "h" ? 3_600_000 : 86_400_000);
  return duration > 0 && duration <= 365 * 86_400_000 ? duration : null;
}

function requestComponents(id: string, disabled = false): unknown[] {
  return [{ type: 1, components: [
    { type: 2, style: 4, label: "Подтвердить бан", custom_id: `staff-admin:ban-approve:${id}`, disabled },
    { type: 2, style: 2, label: "Отклонить", custom_id: `staff-admin:ban-reject:${id}`, disabled }
  ] }];
}

export async function submitStaffBan(i: DiscordInteraction, env: Env): Promise<Response> {
  if (!isStaff(i, env)) return ephemeral("❌ Недостаточно прав.");
  const requester = interactionUser(i);
  const targetUserId = (i.data?.custom_id ?? "").slice("staff-admin:ban-modal:".length);
  const reason = modalValue(i, "reason")?.trim();
  const parsed = parseDuration(modalValue(i, "duration") ?? "");
  if (!requester || !targetUserId || !reason) return ephemeral("❌ Заполните все поля.");
  if (parsed === null) return ephemeral("❌ Срок укажите как `1h`, `12h`, `1d`, `7d` или `навсегда`.");
  if (targetUserId === requester.id) return ephemeral("❌ Нельзя запросить бан самому себе.");
  const id = crypto.randomUUID();
  const request: StaffBanRequest = { id, requesterId: requester.id, targetUserId, reason, ...(parsed ? { durationMs: parsed } : {}), createdAt: Date.now(), status: "PENDING" };
  const durationText = parsed ? `<t:${Math.floor((Date.now() + parsed) / 1000)}:R>` : "навсегда";
  const message = await sendChannelMessage(env, env.STAFF_APPLICATION_CHANNEL_ID, {
    embeds: [{ title: "⛔ Запрос на бан", color: 0xe74c3c, fields: [
      { name: "Участник", value: `<@${targetUserId}> (\`${targetUserId}\`)` },
      { name: "Запросил", value: `<@${requester.id}>`, inline: true }, { name: "Срок", value: durationText, inline: true },
      { name: "Причина / доказательства", value: reason }
    ], footer: { text: "Подтвердить или отклонить может только Administrator" } }],
    components: requestComponents(id), allowed_mentions: { parse: [] }
  });
  request.approvalMessageId = message.id;
  await env.APPLICATIONS.put(`${REQUEST_PREFIX}${id}`, JSON.stringify(request), { expirationTtl: 2_592_000 });
  return ephemeral("✅ Запрос отправлен старшей администрации на подтверждение.");
}

export async function reviewStaffBan(i: DiscordInteraction, env: Env): Promise<Response> {
  if (i.guild_id !== env.DISCORD_GUILD_ID || !isAdministrator(i)) return ephemeral("❌ Подтвердить решение может только пользователь с правом Administrator.");
  const match = /^staff-admin:ban-(approve|reject):([0-9a-f-]{36})$/i.exec(i.data?.custom_id ?? "");
  const reviewer = interactionUser(i);
  if (!match || !reviewer) return ephemeral("❌ Некорректный запрос.");
  const request = await env.APPLICATIONS.get<StaffBanRequest>(`${REQUEST_PREFIX}${match[2]}`, "json");
  if (!request || request.status !== "PENDING") return ephemeral("ℹ️ Этот запрос уже обработан или устарел.");
  const approved = match[1] === "approve";
  if (approved) {
    await discordRest(env, `/guilds/${env.DISCORD_GUILD_ID}/bans/${request.targetUserId}`, { method: "PUT", headers: { "X-Audit-Log-Reason": encodeURIComponent(`${request.reason}; approved by ${reviewer.id}`) }, body: JSON.stringify({ delete_message_seconds: 0 }) });
    if (request.durationMs) {
      request.unbanAt = Date.now() + request.durationMs;
      await env.APPLICATIONS.put(`${ACTIVE_PREFIX}${request.id}`, JSON.stringify(request), { expirationTtl: Math.ceil(request.durationMs / 1000) + 604800 });
    }
  }
  request.status = approved ? "APPROVED" : "REJECTED";
  request.reviewerId = reviewer.id; request.reviewedAt = Date.now();
  await env.APPLICATIONS.put(`${REQUEST_PREFIX}${request.id}`, JSON.stringify(request), { expirationTtl: 2_592_000 });
  if (i.channel_id && i.message?.id) await discordRest(env, `/channels/${i.channel_id}/messages/${i.message.id}`, { method: "PATCH", body: JSON.stringify({ components: requestComponents(request.id, true) }) });
  return ephemeral(`${approved ? "✅ Бан подтверждён и применён" : "↩️ Запрос отклонён"}. Решение: <@${reviewer.id}>.`);
}

export async function expireStaffBans(env: Env): Promise<void> {
  const page = await env.APPLICATIONS.list({ prefix: ACTIVE_PREFIX });
  for (const key of page.keys) {
    const request = await env.APPLICATIONS.get<StaffBanRequest>(key.name, "json");
    if (!request?.unbanAt || request.unbanAt > Date.now()) continue;
    await discordRest(env, `/guilds/${env.DISCORD_GUILD_ID}/bans/${request.targetUserId}`, { method: "DELETE", headers: { "X-Audit-Log-Reason": encodeURIComponent("Temporary Staff ban expired") } }).catch(() => undefined);
    await env.APPLICATIONS.delete(key.name);
  }
}
