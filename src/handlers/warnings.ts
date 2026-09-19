import {
  adminPanel, blacklistModal, userSelector, warnModal, warningChannelButtons, wipeAnnouncementButtons,
  wipeAttendanceDecisionButtons, wipeAttendanceUserSelector, wipeModal, wipeSquareModal
} from "../discord/components";
import { InteractionResponseType, ephemeral, jsonResponse } from "../discord/interactions";
import { isAdministrator, isPrivateModerator } from "../discord/permissions";
import { discordRest, sendChannelMessage } from "../discord/rest";
import { deleteWarningRecord, getMemberLink, getWarningRecord, saveWarningRecord } from "../storage/applications";
import type { DiscordEmbed, DiscordInteraction, DiscordUser, Env, MemberLink, WarningEntry, WarningRecord, WipeAttendanceRecord, WipeRecord, WipeRsvp } from "../types";
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
  const yes = attendance.filter((item) => item.rsvp === "yes").length;
  const late = attendance.filter((item) => item.rsvp === "late").length;
  const no = attendance.filter((item) => item.rsvp === "no").length;
  const mapLine = record.mapUrl ? `\n[Открыть карту](${record.mapUrl})` : "";
  const square = record.mapSquare ? `🟥 **Отмеченный квадрат: ${record.mapSquare}**` : "Квадрат пока не отмечен";
  const embed: DiscordEmbed = {
    title: `📢 Вайп: ${record.project}`,
    description: `**Сбор:** <t:${Math.floor(record.gatherAt / 1000)}:F>\n**Вайп:** <t:${Math.floor(record.wipeAt / 1000)}:F>\n**Подключение:** \`${record.connect}\`\n${square}${mapLine}`,
    color: 0xe67e22,
    fields: [
      { name: "✅ Будут", value: String(yes), inline: true },
      { name: "🕒 Опоздают", value: String(late), inline: true },
      { name: "❌ Не смогут", value: String(no), inline: true }
    ],
    ...(record.mapUrl ? { url: record.mapUrl } : {}),
    ...(record.mapUrl && isImageUrl(record.mapUrl) ? { image: { url: record.mapUrl } } : {})
  };
  return { content: "Выберите свой статус на вайп. Колер может отметить квадрат на карте.", embeds: [embed], components: wipeAnnouncementButtons(record.id) };
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

async function issueAutomaticWipeWarning(env: Env, userId: string, moderatorId: string, project: string): Promise<{ level: 1 | 2; channelId: string } | null> {
  const existing = await getWarningRecord(env, userId);
  const level: 1 | 2 | null = !existing?.warnings.some((warning) => warning.level === 1)
    ? 1
    : !existing.warnings.some((warning) => warning.level === 2) ? 2 : null;
  if (!level) return null;
  const reason = `Не заход на вайп: ${project}`;
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
  const message = await sendChannelMessage(env, env.WIPE_CHANNEL_ID, wipeMessage(item, []));
  item.messageId = message.id;
  await env.APPLICATIONS.put(wipeKey(id), JSON.stringify(item), { expirationTtl: 2_592_000 });
  return ephemeral(`✅ Уведомление создано в <#${env.WIPE_CHANNEL_ID}>.`);
}

export async function respondToWipe(i: DiscordInteraction, env: Env): Promise<Response> {
  const user = interactionUser(i);
  const match = /^wipe:rsvp:(yes|late|no):([0-9a-f-]{36})$/i.exec(i.data?.custom_id ?? "");
  if (!user || !match || i.guild_id !== env.PRIVATE_GUILD_ID) return ephemeral("❌ Не удалось сохранить ответ.");
  const rsvp = match[1] as WipeRsvp; const wipeId = match[2];
  if (!wipeId) return ephemeral("❌ Не удалось определить вайп.");
  const wipe = await env.APPLICATIONS.get<WipeRecord>(wipeKey(wipeId), "json");
  if (!wipe) return ephemeral("⚠️ Этот вайп больше не активен.");
  const key = attendanceKey(wipeId, user.id);
  const existing = await env.APPLICATIONS.get<WipeAttendanceRecord>(key, "json");
  const record: WipeAttendanceRecord = { ...(existing ?? {}), wipeId, userId: user.id, rsvp, updatedAt: Date.now() };
  await env.APPLICATIONS.put(key, JSON.stringify(record), { expirationTtl: 2_592_000 });
  await refreshWipeMessage(env, wipe);
  const labels: Record<WipeRsvp, string> = { yes: "✅ Буду", late: "🕒 Опоздаю", no: "❌ Не смогу" };
  return ephemeral(`Ответ сохранён: **${labels[rsvp]}**.`);
}

export function openWipeSquareModal(i: DiscordInteraction, env: Env): Response {
  if (!isPrivateModerator(i, env)) return ephemeral("❌ Отметить квадрат может только Staff/колер.");
  const wipeId = (i.data?.custom_id ?? "").slice("wipe:square:".length);
  return /^[0-9a-f-]{36}$/i.test(wipeId)
    ? jsonResponse({ type: InteractionResponseType.Modal, data: wipeSquareModal(wipeId) })
    : ephemeral("❌ Некорректный вайп.");
}

export async function submitWipeSquare(i: DiscordInteraction, env: Env): Promise<Response> {
  if (!isPrivateModerator(i, env)) return ephemeral("❌ Отметить квадрат может только Staff/колер.");
  const wipeId = (i.data?.custom_id ?? "").slice("wipe:square-modal:".length);
  const square = modalValue(i, "square")?.trim().toUpperCase();
  if (!square || !/^[A-ZА-ЯЁ]{1,3}\s?-?\d{1,3}$/u.test(square)) return ephemeral("❌ Укажите квадрат в формате H14.");
  const normalizedSquare = square;
  const wipe = await env.APPLICATIONS.get<WipeRecord>(wipeKey(wipeId), "json");
  if (!wipe) return ephemeral("⚠️ Вайп не найден.");
  wipe.mapSquare = normalizedSquare;
  await env.APPLICATIONS.put(wipeKey(wipe.id), JSON.stringify(wipe), { expirationTtl: 2_592_000 });
  await refreshWipeMessage(env, wipe);
  return ephemeral(`✅ На карточке вайпа отмечен квадрат **${normalizedSquare}**.`);
}

export async function openWipeAttendance(i: DiscordInteraction, env: Env): Promise<Response> {
  if (!isPrivateModerator(i, env)) return ephemeral("❌ Недостаточно прав.");
  const wipe = await latestReviewableWipe(env);
  if (!wipe) return ephemeral("⚠️ Пока нет вайпа, после которого прошло 5 часов.");
  const records = await getWipeAttendance(env, wipe.id);
  const members: MemberLink[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.APPLICATIONS.list({ prefix: "member:", ...(cursor ? { cursor } : {}) });
    for (const key of page.keys) {
      const member = await env.APPLICATIONS.get<MemberLink>(key.name, "json");
      if (member) members.push(member);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  const lines = members.slice(0, 35).map((member) => {
    const result = records.find((record) => record.userId === member.discordUserId);
    const mark = result?.present === true ? "✅ зашёл" : result?.present === false ? "⚠️ не зашёл" : result?.rsvp === "yes" ? "🟢 обещал быть" : result?.rsvp === "late" ? "🕒 опоздает" : result?.rsvp === "no" ? "🔴 не сможет" : "⚪ нет ответа";
    return `<@${member.discordUserId}> — ${mark}`;
  });
  const overflow = members.length > 35 ? `\n…и ещё ${members.length - 35}` : "";
  return jsonResponse({ type: InteractionResponseType.ChannelMessageWithSource, data: {
    content: `📋 **Явка на вайп: ${wipe.project}**\n${lines.join("\n") || "Нет участников со Steam-привязкой."}${overflow}\n\nВыберите участника и отметьте результат:`,
    components: wipeAttendanceUserSelector(wipe.id), flags: 64, allowed_mentions: { parse: [] }
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
  if (existing?.present === present) return ephemeral("ℹ️ Такой результат уже сохранён.");
  let warningText = "";
  if (!present) {
    const warning = await issueAutomaticWipeWarning(env, userId, moderator.id, wipe.project);
    warningText = warning ? ` Выдан Warn ${warning.level}: <#${warning.channelId}>.` : " У пользователя уже есть Warn 1 и Warn 2; новый варн не создан.";
  }
  const record: WipeAttendanceRecord = { ...(existing ?? {}), wipeId, userId, present, moderatorId: moderator.id, updatedAt: Date.now() };
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
  const page = await env.APPLICATIONS.list({ prefix: "wipe:" });
  for (const key of page.keys) { const item = await env.APPLICATIONS.get<WipeRecord>(key.name, "json");
    if (!item || item.sent || item.notifyAt > Date.now()) continue;
    await sendChannelMessage(env, env.WIPE_CHANNEL_ID, { content: `@everyone 📢 **Скоро сбор на вайп: ${item.project}**\nСбор: <t:${Math.floor(item.gatherAt / 1000)}:R>\nВайп: <t:${Math.floor(item.wipeAt / 1000)}:F>\nПодключение: \`${item.connect}\`${item.mapSquare ? `\nКвадрат: **${item.mapSquare}**` : ""}`, allowed_mentions: { parse: ["everyone"] } });
    item.sent = true; await env.APPLICATIONS.put(key.name, JSON.stringify(item), { expirationTtl: 604800 });
  }
}
