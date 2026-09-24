import {
  adminPanel, blacklistModal, userSelector, warnModal, warningChannelButtons, wipeAnnouncementButtons,
  wipeAbsenceModal, wipeAttendanceDecisionButtons, wipeAttendanceUserSelector, wipeModal, wipeSquareModal
} from "../discord/components";
import { InteractionResponseType, ephemeral, jsonResponse } from "../discord/interactions";
import { isAdministrator, isPrivateModerator } from "../discord/permissions";
import { discordRest, sendChannelMessage } from "../discord/rest";
import { deleteWarningRecord, getMemberLink, getWarningRecord, saveWarningRecord } from "../storage/applications";
import type { DiscordEmbed, DiscordInteraction, DiscordUser, Env, WarningEntry, WarningRecord, WipeAttendanceRecord, WipeRecord, WipeRsvp } from "../types";
import { currentWipeRoster, absenceReason } from "./wipeRoster";
import { interactionUser, modalValue } from "./helpers";

const THREE_DAYS = 259_200_000;
const FIVE_HOURS = 18_000_000;
const roleFor = (env: Env, level: 1 | 2) => level === 1 ? env.PRIVATE_WARN_1_ROLE_ID : env.PRIVATE_WARN_2_ROLE_ID;
const wipeKey = (id: string) => `wipe:${id}`;
const attendanceKey = (wipeId: string, userId: string) => `wipe-attendance:${wipeId}:${userId}`;

function validHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch { return undefined; }
}

function isImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /\.(?:png|jpe?g|webp|gif)$/i.test(url.pathname) || ["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname);
  } catch { return false; }
}

async function getWipeAttendance(env: Env, wipeId: string): Promise<WipeAttendanceRecord[]> {
  const records: WipeAttendanceRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.APPLICATIONS.list({ prefix: `wipe-attendance:${wipeId}:`, ...(cursor ? { cursor } : {}) });
    for (const key of page.keys) {
      const record = await env.APPLICATIONS.get<WipeAttendanceRecord>(key.name, "json");
      if (record) records.push(record);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return records;
}

function wipeMessage(record: WipeRecord, attendance: WipeAttendanceRecord[]): { content: string; embeds: DiscordEmbed[]; components: unknown[] } {
  const yes = attendance.filter((item) => item.rsvp === "yes");
  const late = attendance.filter((item) => item.rsvp === "late");
  const no = attendance.filter((item) => item.rsvp === "no");
  const playerList = (items: WipeAttendanceRecord[], withReason = false): string => {
    if (!items.length) return "—";
    const lines = items.map((item) => `<@${item.userId}>${withReason && item.reason ? ` — ${item.reason}` : ""}`);
    let result = "";
    for (const line of lines) {
      if (`${result}${result ? "\n" : ""}${line}`.length > 1000) return `${result}\n…и ещё ${lines.length - result.split("\n").length}`;
      result += `${result ? "\n" : ""}${line}`;
    }
    return result;
  };
  const mapLine = record.mapUrl ? `\n[Открыть карту](${record.mapUrl})` : "";
  const square = record.mapSquare
    ? `🏗️ **Спот для строительства: ${record.mapSquare}**`
    : "🏗️ **Спот для строительства:** ещё не указан";
  const embed: DiscordEmbed = {
    title: `📢 Вайп: ${record.project}`,
    description: `**Сбор:** <t:${Math.floor(record.gatherAt / 1000)}:F>\n**Вайп:** <t:${Math.floor(record.wipeAt / 1000)}:F>\n**Подключение:** \`${record.connect}\`\n${square}${mapLine}`,
    color: 0xe67e22,
    fields: [
      { name: `✅ Будут — ${yes.length}`, value: playerList(yes) },
      { name: `🕒 Опоздают — ${late.length}`, value: playerList(late) },
      { name: `❌ Не смогут — ${no.length}`, value: playerList(no, true) }
    ],
    ...(record.mapUrl ? { url: record.mapUrl } : {}),
    ...(record.mapUrl && isImageUrl(record.mapUrl) ? { image: { url: record.mapUrl } } : {})
  };
  return { content: "Выберите статус на вайп. Повторное нажатие изменит ваш ответ. Для «Не смогу» потребуется причина.", embeds: [embed], components: wipeAnnouncementButtons(record.id) };
}

async function refreshWipeMessage(env: Env, record: WipeRecord): Promise<void> {
  if (!record.messageId) return;
  const attendance = await getWipeAttendance(env, record.id);
  await discordRest(env, `/channels/${env.WIPE_CHANNEL_ID}/messages/${record.messageId}`, {
    method: "PATCH",
    body: JSON.stringify(wipeMessage(record, attendance))
  });
}

async function latestReviewableWipe(env: Env): Promise<WipeRecord | null> {
  const records: WipeRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.APPLICATIONS.list({ prefix: "wipe:", ...(cursor ? { cursor } : {}) });
    for (const key of page.keys) {
      const record = await env.APPLICATIONS.get<WipeRecord>(key.name, "json");
      if (record && /^[0-9a-f-]{36}$/i.test(record.id) && Date.now() >= record.wipeAt + FIVE_HOURS) records.push(record);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return records.sort((a, b) => b.wipeAt - a.wipeAt)[0] ?? null;
}

async function nextPendingWipe(env: Env): Promise<WipeRecord | null> {
  const records: WipeRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.APPLICATIONS.list({ prefix: "wipe:", ...(cursor ? { cursor } : {}) });
    for (const key of page.keys) {
      const record = await env.APPLICATIONS.get<WipeRecord>(key.name, "json");
      if (record && /^[0-9a-f-]{36}$/i.test(record.id) && Date.now() < record.wipeAt + FIVE_HOURS) records.push(record);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return records.sort((a, b) => a.wipeAt - b.wipeAt)[0] ?? null;
}

export async function setupAdminPanel(i: DiscordInteraction, env: Env): Promise<Response> {
  if (!isAdministrator(i) || i.guild_id !== env.PRIVATE_GUILD_ID) return ephemeral("❌ Только Administrator может создать панель.");
  await sendChannelMessage(env, env.PRIVATE_ADMIN_CHANNEL_ID, adminPanel());
  return ephemeral(`✅ Новая админ-панель опубликована в <#${env.PRIVATE_ADMIN_CHANNEL_ID}>.`);
}

export function openUserSelection(i: DiscordInteraction, env: Env, action: "warn" | "member-info" | "blacklist" | "clan-stats"): Response {
  if (!isPrivateModerator(i, env)) return ephemeral("❌ Недостаточно прав.");
  return jsonResponse({ type: InteractionResponseType.ChannelMessageWithSource, data: { content: "Выберите пользователя:", components: userSelector(action), flags: 64 } });
}

export function selectBlacklistUser(i: DiscordInteraction, env: Env): Response {
  if (!isPrivateModerator(i, env)) return ephemeral("❌ Недостаточно прав.");
  const userId = i.data?.values?.[0];
  return userId ? jsonResponse({ type: InteractionResponseType.Modal, data: blacklistModal(userId) }) : ephemeral("❌ Пользователь не выбран.");
}

export async function permanentBlacklist(i: DiscordInteraction, env: Env): Promise<Response> {
  if (!isPrivateModerator(i, env)) return ephemeral("❌ Недостаточно прав.");
  const userId = i.data?.custom_id?.split(":").at(-1); const reason = modalValue(i, "reason")?.trim(); const moderator = interactionUser(i);
  if (!userId || !/^\d{17,20}$/.test(userId) || !reason || !moderator) return ephemeral("❌ Не удалось определить пользователя или причину.");
  const auditReason = encodeURIComponent(`Постоянный ЧС: ${reason} | moderator ${moderator.id}`.slice(0, 500));
  const results = await Promise.allSettled([env.PRIVATE_GUILD_ID, env.DISCORD_GUILD_ID].map((guildId) => discordRest(env, `/guilds/${guildId}/bans/${userId}`, { method: "PUT", headers: { "X-Audit-Log-Reason": auditReason }, body: JSON.stringify({ delete_message_seconds: 0 }) })));
  if (results.every((r) => r.status === "rejected")) return ephemeral("❌ Не удалось забанить пользователя. Проверьте права роли бота.");
  await env.APPLICATIONS.put(`blacklist:${userId}`, JSON.stringify({ userId, reason, moderatorId: moderator.id, createdAt: Date.now() }));
  await sendChannelMessage(env, env.BLACKLIST_CHANNEL_ID, { content: `⛔ **Постоянный ЧС**\nПользователь: <@${userId}> (\`${userId}\`)\nПричина: ${reason}\nВыдал: <@${moderator.id}>`, allowed_mentions: { parse: [] } });
  const count = results.filter((r) => r.status === "fulfilled").length;
  return ephemeral(`✅ Пользователь добавлен в постоянный ЧС и забанен на ${count} сервер(ах) .int.`);
}

export function selectWarningUser(i: DiscordInteraction, env: Env): Response {
  if (!isPrivateModerator(i, env)) return ephemeral("❌ Недостаточно прав.");
  const userId = i.data?.values?.[0];
  return userId ? jsonResponse({ type: InteractionResponseType.Modal, data: warnModal(userId) }) : ephemeral("❌ Пользователь не выбран.");
}

export async function selectedMemberInfo(i: DiscordInteraction, env: Env): Promise<Response> {
  if (!isPrivateModerator(i, env)) return ephemeral("❌ Недостаточно прав.");
  const userId = i.data?.values?.[0];
  if (!userId) return ephemeral("❌ Пользователь не выбран.");
  const link = await getMemberLink(env, userId);
  return link ? ephemeral(`🔗 <@${userId}>\nSteam: [${link.steamName}](${link.steamUrl})\nSteamID64: \`${link.steamId64}\`\nИмя: ${link.realName}\nРоль: ${link.role}`) : ephemeral(`⚠️ Для <@${userId}> Steam-привязка не найдена.`);
}

const safeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9а-яё_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "user";

async function createWarnChannel(env: Env, userId: string, level: 1 | 2): Promise<string> {
  const user = await discordRest<DiscordUser>(env, `/users/${userId}`);
  const allow = (1024n | 2048n | 16384n | 32768n | 65536n).toString();
  const channel = await discordRest<{ id: string }>(env, `/guilds/${env.PRIVATE_GUILD_ID}/channels`, { method: "POST", body: JSON.stringify({
    name: `warn-${level}-${safeName(user.global_name || user.username)}`, type: 0, parent_id: env.PUNISHMENT_CATEGORY_ID,
    permission_overwrites: [
      { id: env.PRIVATE_GUILD_ID, type: 0, allow: "0", deny: "1024" }, { id: userId, type: 1, allow, deny: "0" },
      { id: env.PRIVATE_MODERATOR_ROLE_ID, type: 0, allow, deny: "0" }, { id: env.DISCORD_APPLICATION_ID, type: 1, allow, deny: "0" }
    ]
  }) });
  return channel.id;
}

async function issueAutomaticWipeWarning(env: Env, userId: string, moderatorId: string, reason: string): Promise<{ level: 1 | 2; channelId: string } | null> {
  const existing = await getWarningRecord(env, userId);
  const level: 1 | 2 | null = !existing?.warnings.some((warning) => warning.level === 1)
    ? 1
    : !existing.warnings.some((warning) => warning.level === 2) ? 2 : null;
  if (!level) return null;
  const channelId = await createWarnChannel(env, userId, level);
  const warning: WarningEntry = { level, reason, moderatorId, issuedAt: Date.now(), expiresAt: Date.now() + THREE_DAYS, channelId };
  await discordRest(env, `/guilds/${env.PRIVATE_GUILD_ID}/members/${userId}/roles/${roleFor(env, level)}`, { method: "PUT" });
  await saveWarningRecord(env, { userId, channelId, warnings: [...(existing?.warnings ?? []), warning] });
  const moderatorTag = level === 2 ? `\n<@&${env.PRIVATE_MODERATOR_ROLE_ID}> требуется рассмотреть повторное нарушение.` : "";
  await sendChannelMessage(env, channelId, {
    content: `⚠️ <@${userId}>, вы получили **Warn ${level}**.\n**Причина:** ${reason}\n**Истекает:** <t:${Math.floor(warning.expiresAt / 1000)}:F> (<t:${Math.floor(warning.expiresAt / 1000)}:R>)\n\nОставшееся время: \`/warn-status\`.${moderatorTag}`,
    components: warningChannelButtons(userId, level),
    allowed_mentions: { users: [userId], roles: level === 2 ? [env.PRIVATE_MODERATOR_ROLE_ID] : [] }
  });
  return { level, channelId };
}

export async function issueWarning(i: DiscordInteraction, env: Env): Promise<Response> {
  if (!isPrivateModerator(i, env)) return ephemeral("❌ Недостаточно прав.");
  const userId = i.data?.custom_id?.split(":").at(-1); const rawLevel = modalValue(i, "level");
  const reason = modalValue(i, "reason")?.trim(); const moderator = interactionUser(i);
  if (!userId || !/^\d{17,20}$/.test(userId) || (rawLevel !== "1" && rawLevel !== "2") || !reason || !moderator) return ephemeral("❌ Проверьте уровень и причину.");
  const level = Number(rawLevel) as 1 | 2; const existing = await getWarningRecord(env, userId);
  if (existing?.warnings.some((w) => w.level === level)) return ephemeral(`⚠️ У пользователя уже есть Warn ${level}.`);
  const channelId = await createWarnChannel(env, userId, level);
  const warning: WarningEntry = { level, reason, moderatorId: moderator.id, issuedAt: Date.now(), expiresAt: Date.now() + THREE_DAYS, channelId };
  await discordRest(env, `/guilds/${env.PRIVATE_GUILD_ID}/members/${userId}/roles/${roleFor(env, level)}`, { method: "PUT" });
  await saveWarningRecord(env, { userId, channelId, warnings: [...(existing?.warnings ?? []), warning] });
  const tag = level === 2 ? `\n<@&${env.PRIVATE_MODERATOR_ROLE_ID}> требуется рассмотреть ситуацию.` : "";
  await sendChannelMessage(env, channelId, { content: `⚠️ <@${userId}>, вы получили **Warn ${level}**.\n**Причина:** ${reason}\n**Истекает:** <t:${Math.floor(warning.expiresAt / 1000)}:F> (<t:${Math.floor(warning.expiresAt / 1000)}:R>)\n\nОставшееся время: \`/warn-status\`. Здесь можно обсудить нарушение с модератором.${tag}`, components: warningChannelButtons(userId, level), allowed_mentions: { users: [userId], roles: level === 2 ? [env.PRIVATE_MODERATOR_ROLE_ID] : [] } });
  return ephemeral(`✅ Warn ${level} выдан. Канал: <#${channelId}>.`);
}

export async function removeWarningFromChannel(i: DiscordInteraction, env: Env): Promise<Response> {
  if (!isPrivateModerator(i, env)) return ephemeral("❌ Снять варн может только модератор.");
  const [, , userId, rawLevel] = i.data?.custom_id?.split(":") ?? [];
  if (!userId || (rawLevel !== "1" && rawLevel !== "2")) return ephemeral("❌ Некорректная кнопка.");
  const level = Number(rawLevel) as 1 | 2; const record = await getWarningRecord(env, userId);
  if (!record?.warnings.some((w) => w.level === level)) return ephemeral("⚠️ Этот варн уже снят или истёк.");
  await discordRest(env, `/guilds/${env.PRIVATE_GUILD_ID}/members/${userId}/roles/${roleFor(env, level)}`, { method: "DELETE" });
  record.warnings = record.warnings.filter((w) => w.level !== level);
  if (record.warnings.length) await saveWarningRecord(env, record); else await deleteWarningRecord(env, userId);
  if (i.channel_id) await discordRest(env, `/channels/${i.channel_id}`, { method: "DELETE" });
  return ephemeral(`✅ Warn ${level} снят.`);
}

export async function ownWarningStatus(i: DiscordInteraction, env: Env): Promise<Response> {
  const user = interactionUser(i); if (!user) return ephemeral("❌ Пользователь не найден.");
  const record = await getWarningRecord(env, user.id);
  return record?.warnings.length ? ephemeral(record.warnings.map((w) => `⚠️ **Warn ${w.level}** — ${w.reason}\nИстекает <t:${Math.floor(w.expiresAt / 1000)}:R>`).join("\n\n")) : ephemeral("✅ У вас нет активных предупреждений.");
}

export async function kickFromWarning(i: DiscordInteraction, env: Env): Promise<Response> {
  if (i.guild_id !== env.PRIVATE_GUILD_ID || !isPrivateModerator(i, env)) return ephemeral("❌ Только модератор привата может кикнуть участника.");
  const match = /^warning:(kick|kick-confirm):(\d{17,20})$/.exec(i.data?.custom_id ?? "");
  const userId = match?.[2];
  if (!userId) return ephemeral("Некорректная кнопка.");
  const record = await getWarningRecord(env, userId);
  const warning = record?.warnings.find(w => w.level === 2 && w.expiresAt > Date.now() && (w.channelId || record.channelId) === i.channel_id);
  if (!warning) return ephemeral("Активный второй варн в этом канале не найден.");
  if (match[1] === "kick") return jsonResponse({ type: InteractionResponseType.ChannelMessageWithSource, data: {
    content: `Исключить <@${userId}> из приватного сервера за второй варн? Это кик, без постоянного бана.`, flags: 64, allowed_mentions: { parse: [] },
    components: [{ type: 1, components: [{ type: 2, style: 4, label: "Подтвердить кик", custom_id: `warning:kick-confirm:${userId}` }] }]
  } });
  await discordRest(env, `/guilds/${env.PRIVATE_GUILD_ID}/members/${userId}`, { method: "DELETE", headers: { "X-Audit-Log-Reason": encodeURIComponent(`Warn 2; moderator ${interactionUser(i)?.id ?? "unknown"}`) } });
  return ephemeral("✅ Участник исключён из привата.");
}

export function openWipeModal(i: DiscordInteraction, env: Env): Response {
  return isPrivateModerator(i, env) ? jsonResponse({ type: InteractionResponseType.Modal, data: wipeModal() }) : ephemeral("❌ Недостаточно прав.");
}

export async function submitWipe(i: DiscordInteraction, env: Env): Promise<Response> {
  if (!isPrivateModerator(i, env)) return ephemeral("❌ Недостаточно прав.");
  const project = modalValue(i, "project")?.trim(); const wipe = modalValue(i, "wipe_time")?.trim();
  const connect = modalValue(i, "connect")?.trim(); const before = modalValue(i, "gather_before")?.trim();
  const rawMapUrl = modalValue(i, "map_url")?.trim(); const mapUrl = validHttpUrl(rawMapUrl);
  if (!project || !wipe || !connect || !before || !["1", "2"].includes(before)) return ephemeral("❌ Заполните все поля; сбор можно выбрать за 1 или 2 часа.");
  if (rawMapUrl && !mapUrl) return ephemeral("❌ Ссылка на карту должна начинаться с http:// или https://.");
  const wipeAt = Date.parse(wipe.replace(" ", "T") + ":00+03:00");
  if (!Number.isFinite(wipeAt)) return ephemeral("❌ Формат времени: ГГГГ-ММ-ДД ЧЧ:ММ (МСК).");
  const gatherAt = wipeAt - Number(before) * 3_600_000;
  if (gatherAt <= Date.now()) return ephemeral("❌ Время сбора уже прошло. Укажите будущий вайп.");
  const id = crypto.randomUUID();
  const item: WipeRecord = { id, project, wipeAt, gatherAt, connect, notifyAt: gatherAt, sent: false, createdAt: Date.now(), ...(mapUrl ? { mapUrl } : {}) };
  item.expectedUserIds = (await currentWipeRoster(env)).map(member => member.user.id);
  const message = await sendChannelMessage(env, env.WIPE_CHANNEL_ID, wipeMessage(item, []));
  item.messageId = message.id;
  await env.APPLICATIONS.put(wipeKey(id), JSON.stringify(item), { expirationTtl: 2_592_000 });
  return ephemeral(`✅ Уведомление создано в <#${env.WIPE_CHANNEL_ID}>.`);
}

export async function respondToWipe(i: DiscordInteraction, env: Env): Promise<Response> {
  const user = interactionUser(i);
  const match = /^wipe:rsvp:(yes|late):([0-9a-f-]{36})$/i.exec(i.data?.custom_id ?? "");
  if (!user || !match || i.guild_id !== env.PRIVATE_GUILD_ID) return ephemeral("❌ Не удалось сохранить ответ.");
  const rsvp = match[1] as WipeRsvp; const wipeId = match[2];
  if (!wipeId) return ephemeral("❌ Не удалось определить вайп.");
  const wipe = await env.APPLICATIONS.get<WipeRecord>(wipeKey(wipeId), "json");
  if (!wipe) return ephemeral("⚠️ Этот вайп больше не активен.");
  if (Date.now() >= wipe.wipeAt) return ephemeral("Ответы закрыты: вайп уже начался.");
  const key = attendanceKey(wipeId, user.id);
  const existing = await env.APPLICATIONS.get<WipeAttendanceRecord>(key, "json");
  const record: WipeAttendanceRecord = {
    ...existing,
    wipeId, userId: user.id, rsvp, updatedAt: Date.now(),
    ...(existing?.present !== undefined ? { present: existing.present } : {}),
    ...(existing?.moderatorId ? { moderatorId: existing.moderatorId } : {})
  };
  await env.APPLICATIONS.put(key, JSON.stringify(record), { expirationTtl: 2_592_000 });
  await refreshWipeMessage(env, wipe);
  const labels: Record<WipeRsvp, string> = { yes: "✅ Буду", late: "🕒 Опоздаю", no: "❌ Не смогу" };
  const changed = existing?.rsvp && existing.rsvp !== rsvp;
  return ephemeral(`${changed ? "Ответ изменён" : "Ответ сохранён"}: **${labels[rsvp]}**. Его можно поменять повторным нажатием.`);
}

export function openWipeAbsenceModal(i: DiscordInteraction, env: Env): Response {
  const user = interactionUser(i);
  const wipeId = (i.data?.custom_id ?? "").slice("wipe:rsvp:no:".length);
  if (!user || i.guild_id !== env.PRIVATE_GUILD_ID || !/^[0-9a-f-]{36}$/i.test(wipeId)) return ephemeral("❌ Не удалось определить вайп.");
  return jsonResponse({ type: InteractionResponseType.Modal, data: wipeAbsenceModal(wipeId) });
}

export async function submitWipeAbsence(i: DiscordInteraction, env: Env): Promise<Response> {
  const user = interactionUser(i);
  const wipeId = (i.data?.custom_id ?? "").slice("wipe:rsvp-no-modal:".length);
  const reason = modalValue(i, "reason")?.trim();
  if (!user || i.guild_id !== env.PRIVATE_GUILD_ID || !/^[0-9a-f-]{36}$/i.test(wipeId) || !reason) return ephemeral("❌ Укажите причину отсутствия.");
  const wipe = await env.APPLICATIONS.get<WipeRecord>(wipeKey(wipeId), "json");
  if (!wipe) return ephemeral("⚠️ Этот вайп больше не активен.");
  if (Date.now() >= wipe.wipeAt) return ephemeral("Ответы закрыты: вайп уже начался.");
  const key = attendanceKey(wipeId, user.id);
  const existing = await env.APPLICATIONS.get<WipeAttendanceRecord>(key, "json");
  const record: WipeAttendanceRecord = {
    ...existing,
    wipeId, userId: user.id, rsvp: "no", reason, updatedAt: Date.now(),
    ...(existing?.present !== undefined ? { present: existing.present } : {}),
    ...(existing?.moderatorId ? { moderatorId: existing.moderatorId } : {})
  };
  await env.APPLICATIONS.put(key, JSON.stringify(record), { expirationTtl: 2_592_000 });
  await refreshWipeMessage(env, wipe);
  return ephemeral(`${existing?.rsvp && existing.rsvp !== "no" ? "Ответ изменён" : "Ответ сохранён"}: **❌ Не смогу**. Причина: ${reason}`);
}

export function openWipeSquareModal(i: DiscordInteraction, env: Env): Response {
  if (!isPrivateModerator(i, env)) return ephemeral("❌ Указать спот может только Staff/колер.");
  const wipeId = (i.data?.custom_id ?? "").slice("wipe:square:".length);
  return /^[0-9a-f-]{36}$/i.test(wipeId)
    ? jsonResponse({ type: InteractionResponseType.Modal, data: wipeSquareModal(wipeId) })
    : ephemeral("❌ Некорректный вайп.");
}

export async function submitWipeSquare(i: DiscordInteraction, env: Env): Promise<Response> {
  if (!isPrivateModerator(i, env)) return ephemeral("❌ Указать спот может только Staff/колер.");
  const wipeId = (i.data?.custom_id ?? "").slice("wipe:square-modal:".length);
  const square = modalValue(i, "square")?.trim().toUpperCase();
  if (!square || !/^[A-ZА-ЯЁ]{1,3}\s?-?\d{1,3}$/u.test(square)) return ephemeral("❌ Укажите квадрат в формате H14.");
  const normalizedSquare = square;
  const wipe = await env.APPLICATIONS.get<WipeRecord>(wipeKey(wipeId), "json");
  if (!wipe) return ephemeral("⚠️ Вайп не найден.");
  wipe.mapSquare = normalizedSquare;
  await env.APPLICATIONS.put(wipeKey(wipe.id), JSON.stringify(wipe), { expirationTtl: 2_592_000 });
  await refreshWipeMessage(env, wipe);
  return ephemeral(`✅ Спот для строительства указан: **${normalizedSquare}**.`);
}

export async function openWipeAttendance(i: DiscordInteraction, env: Env): Promise<Response> {
  if (!isPrivateModerator(i, env)) return ephemeral("❌ Недостаточно прав.");
  const requested = /^wipe:roster:([0-9a-f-]{36}):(\d+)(?::back|:refresh|:next)?$/i.exec(i.data?.custom_id ?? "");
  const wipe = requested
    ? await env.APPLICATIONS.get<WipeRecord>(wipeKey(requested[1] ?? ""), "json")
    : await nextPendingWipe(env) ?? await latestReviewableWipe(env);
  if (!wipe) return ephemeral("⚠️ Сейчас нет запланированного вайпа.");
  const canReview = Date.now() >= wipe.wipeAt + FIVE_HOURS;
  const records = await getWipeAttendance(env, wipe.id);
  const members = await currentWipeRoster(env);
  const groups = [
    { title: "✅ Подтвердили", items: members.filter(m => records.some(r => r.userId === m.user.id && (r.rsvp === "yes" || r.rsvp === "late"))) },
    { title: "❌ Не смогут", items: members.filter(m => records.some(r => r.userId === m.user.id && r.rsvp === "no")) },
    { title: "⚪ Остальные не подтвердили", items: members.filter(m => !records.some(r => r.userId === m.user.id && r.rsvp)) }
  ];
  const lines = groups.flatMap(group => [`**${group.title} (${group.items.length})**`, ...group.items.map(member => {
    const result = records.find(r => r.userId === member.user.id);
    const name = (member.nick || member.user.global_name || member.user.username).replace(/[\n\r*_`]/g, " ");
    const status = result?.rsvp === "yes" ? "подтвердил" : result?.rsvp === "late" ? "подтвердил, опоздает" : result?.rsvp === "no" ? `не сможет: ${(result.reason || "причина не указана").replace(/[\r\n]/g, " ")}` : "не подтвердил";
    const actual = result?.present === true ? " · ✅ зашёл" : result?.present === false ? " · ❌ не зашёл" : "";
    return `${name} (<@${member.user.id}>) — ${status}${actual}${result?.warningIssuedAt ? " · варн выдан" : ""}`;
  })]);
  const pages: string[] = [""];
  for (const line of lines) {
    if ((pages.at(-1) ?? "").length + line.length > 1400) pages.push("");
    pages[pages.length - 1] = `${pages.at(-1) ?? ""}${line}\n`;
  }
  const page = Math.min(Number(requested?.[2] ?? 0), pages.length - 1);
  const navigation = [{ type: 1, components: [
    { type: 2, style: 2, label: "Назад", custom_id: `wipe:roster:${wipe.id}:${Math.max(0, page - 1)}:back`, disabled: page === 0 },
    { type: 2, style: 2, label: "Обновить", custom_id: `wipe:roster:${wipe.id}:${page}:refresh` },
    { type: 2, style: 2, label: "Далее", custom_id: `wipe:roster:${wipe.id}:${page + 1}:next`, disabled: page === pages.length - 1 }
  ] }];
  const reviewText = canReview
    ? "\nВыберите участника: «Не зашёл» выдаст варн за отсутствие ответа или нарушенное подтверждение. Отказ с причиной — без автоматического варна."
    : `\n\nПроверка фактической явки откроется <t:${Math.floor((wipe.wipeAt + FIVE_HOURS) / 1000)}:R>. До этого здесь отображается план.`;
  return jsonResponse({ type: InteractionResponseType.ChannelMessageWithSource, data: {
    content: `📋 **${canReview ? "Проверка явки" : "Запланированный вайп"}: ${wipe.project}**\nВайп: <t:${Math.floor(wipe.wipeAt / 1000)}:F> (<t:${Math.floor(wipe.wipeAt / 1000)}:R>)\n${pages[page]}\nСтраница ${page + 1}/${pages.length}${reviewText}`,
    components: [...(canReview ? wipeAttendanceUserSelector(wipe.id) : []), ...navigation], flags: 64, allowed_mentions: { parse: [] }
  } });
}

export function selectWipeAttendanceUser(i: DiscordInteraction, env: Env): Response {
  if (!isPrivateModerator(i, env)) return ephemeral("❌ Недостаточно прав.");
  const wipeId = (i.data?.custom_id ?? "").slice("wipe:attendance-user:".length);
  const userId = i.data?.values?.[0];
  if (!/^[0-9a-f-]{36}$/i.test(wipeId) || !userId) return ephemeral("❌ Пользователь или вайп не выбран.");
  return jsonResponse({ type: InteractionResponseType.ChannelMessageWithSource, data: {
    content: `Отметьте явку <@${userId}>:`, components: wipeAttendanceDecisionButtons(wipeId, userId), flags: 64, allowed_mentions: { parse: [] }
  } });
}

export async function markWipeAttendance(i: DiscordInteraction, env: Env): Promise<Response> {
  if (!isPrivateModerator(i, env)) return ephemeral("❌ Недостаточно прав.");
  const match = /^wipe:(present|absent):([0-9a-f-]{36}):(\d{17,20})$/i.exec(i.data?.custom_id ?? "");
  const moderator = interactionUser(i);
  if (!match || !moderator) return ephemeral("❌ Некорректная отметка.");
  const action = match[1]; const wipeId = match[2]; const userId = match[3];
  if (!action || !wipeId || !userId) return ephemeral("❌ Некорректная отметка.");
  const wipe = await env.APPLICATIONS.get<WipeRecord>(wipeKey(wipeId), "json");
  if (!wipe || Date.now() < wipe.wipeAt + FIVE_HOURS) return ephemeral("⚠️ Проверка явки откроется через 5 часов после вайпа.");
  const key = attendanceKey(wipeId, userId);
  const existing = await env.APPLICATIONS.get<WipeAttendanceRecord>(key, "json");
  const present = action === "present";
  const roster = await currentWipeRoster(env);
  if (!roster.some(member => member.user.id === userId)) return ephemeral("Участник уже вышел из привата или не имеет роли Rust.");
  if (existing?.present === present) return ephemeral("ℹ️ Такой результат уже сохранён.");
  let warningText = "";
  let warningIssuedAt = existing?.warningIssuedAt;
  const reason = absenceReason(existing, wipe.project);
  if (!present && !existing?.rsvp && wipe.expectedUserIds && !wipe.expectedUserIds.includes(userId)) return ephemeral("Этот участник не входил в состав при создании вайпа. Варн за отсутствие ответа не выдан.");
  if (!present && reason) {
    const warning = await issueAutomaticWipeWarning(env, userId, moderator.id, reason);
    if (warning) warningIssuedAt = Date.now();
    warningText = warning ? ` Выдан Warn ${warning.level}: <#${warning.channelId}>.` : " У пользователя уже есть Warn 1 и Warn 2; новый варн не создан.";
  }
  if (!present && existing?.rsvp === "no") warningText = " Участник заранее отказался с причиной; автоматический варн не выдан.";
  if (warningIssuedAt) warningText += " Варн за этот вайп уже учтён; повторно не выдаётся. Снять его можно в чате нарушения.";
  const record: WipeAttendanceRecord = { ...(existing ?? {}), wipeId, userId, present, moderatorId: moderator.id, updatedAt: Date.now(), ...(warningIssuedAt ? { warningIssuedAt } : {}) };
  await env.APPLICATIONS.put(key, JSON.stringify(record), { expirationTtl: 2_592_000 });
  return ephemeral(`${present ? "✅ Участник отмечен как зашедший." : "⚠️ Участник отмечен как не зашедший."}${warningText}`);
}

export async function expireWarnings(env: Env): Promise<void> {
  let cursor: string | undefined;
  do { const page = await env.APPLICATIONS.list({ prefix: "warning:", ...(cursor ? { cursor } : {}) }); cursor = page.list_complete ? undefined : page.cursor;
    for (const key of page.keys) { const record = await env.APPLICATIONS.get<WarningRecord>(key.name, "json"); if (!record) continue;
      const expired = record.warnings.filter((w) => w.expiresAt <= Date.now());
      await Promise.all(expired.flatMap((w) => [
        discordRest(env, `/guilds/${env.PRIVATE_GUILD_ID}/members/${record.userId}/roles/${roleFor(env, w.level)}`, { method: "DELETE" }).catch(() => undefined),
        ...(w.channelId || record.channelId ? [discordRest(env, `/channels/${w.channelId || record.channelId}`, { method: "DELETE" }).catch(() => undefined)] : [])
      ]));
      record.warnings = record.warnings.filter((w) => w.expiresAt > Date.now());
      if (record.warnings.length) await saveWarningRecord(env, record); else await deleteWarningRecord(env, record.userId);
    }
  } while (cursor);
}

export async function sendDueWipeReminders(env: Env): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.APPLICATIONS.list({ prefix: "wipe:", ...(cursor ? { cursor } : {}) });
    cursor = page.list_complete ? undefined : page.cursor;
    for (const key of page.keys) {
      const item = await env.APPLICATIONS.get<WipeRecord>(key.name, "json");
      const now = Date.now();
      if (!item?.id || item.sent || !Number.isFinite(item.notifyAt) || !Number.isFinite(item.wipeAt)
        || now < item.notifyAt || now >= item.wipeAt) continue;

      // A separate marker survives later writes to the wipe record.
      const reminderKey = `wipe-reminder:${item.wipeAt}:${item.connect.toLowerCase()}`;
      if (await env.APPLICATIONS.get(reminderKey)) continue;
      await env.APPLICATIONS.put(reminderKey, String(now), { expirationTtl: 2_592_000 });
      item.sent = true;
      await env.APPLICATIONS.put(key.name, JSON.stringify(item), { expirationTtl: 2_592_000 });
      await sendChannelMessage(env, env.WIPE_CHANNEL_ID, { content: `@everyone 📢 **Скоро сбор на вайп: ${item.project}**\nСбор: <t:${Math.floor(item.gatherAt / 1000)}:R>\nВайп: <t:${Math.floor(item.wipeAt / 1000)}:F>\nПодключение: \`${item.connect}\`${item.mapSquare ? `\n🏗️ Спот для строительства: **${item.mapSquare}**` : ""}`, allowed_mentions: { parse: ["everyone"] } });
    }
  } while (cursor);
}

export async function warnUnansweredWipes(env: Env): Promise<void> {
  let cursor: string | undefined;
  let roster: Awaited<ReturnType<typeof currentWipeRoster>> | undefined;
  do {
    const page = await env.APPLICATIONS.list({ prefix: "wipe:", ...(cursor ? { cursor } : {}) });
    cursor = page.list_complete ? undefined : page.cursor;
    for (const key of page.keys) {
      const wipe = await env.APPLICATIONS.get<WipeRecord>(key.name, "json");
      if (!wipe?.id) continue;
      // Adopt only future legacy wipes; do not punish old events retroactively.
      if (!wipe.expectedUserIds && Date.now() < wipe.wipeAt) {
        roster ??= await currentWipeRoster(env);
        wipe.expectedUserIds = roster.map(member => member.user.id);
        await env.APPLICATIONS.put(key.name, JSON.stringify(wipe), { expirationTtl: 2_592_000 });
      }
      if (!wipe.expectedUserIds || Date.now() < wipe.wipeAt + FIVE_HOURS || Date.now() > wipe.wipeAt + FIVE_HOURS + 86_400_000) continue;
      roster ??= await currentWipeRoster(env);
      for (const userId of wipe.expectedUserIds) {
        if (!roster.some(member => member.user.id === userId)) continue;
        const recordKey = attendanceKey(wipe.id, userId);
        const record = await env.APPLICATIONS.get<WipeAttendanceRecord>(recordKey, "json");
        if (record?.rsvp || record?.warningIssuedAt || record?.present === true) continue;
        const warning = await issueAutomaticWipeWarning(env, userId, env.DISCORD_APPLICATION_ID, `Не ответил на приглашение на вайп: ${wipe.project}`);
        if (warning) await env.APPLICATIONS.put(recordKey, JSON.stringify({ ...record, wipeId: wipe.id, userId, updatedAt: Date.now(), warningIssuedAt: Date.now() }), { expirationTtl: 2_592_000 });
      }
    }
  } while (cursor);
}
