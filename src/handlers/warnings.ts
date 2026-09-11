import { adminPanel, blacklistModal, userSelector, warnModal, warningChannelButtons, wipeModal } from "../discord/components";
import { InteractionResponseType, ephemeral, jsonResponse } from "../discord/interactions";
import { isAdministrator, isPrivateModerator } from "../discord/permissions";
import { discordRest, sendChannelMessage } from "../discord/rest";
import { deleteWarningRecord, getMemberLink, getWarningRecord, saveWarningRecord } from "../storage/applications";
import type { DiscordInteraction, DiscordUser, Env, WarningEntry, WarningRecord } from "../types";
import { interactionUser, modalValue } from "./helpers";

const THREE_DAYS = 259_200_000;
const roleFor = (env: Env, level: 1 | 2) => level === 1 ? env.PRIVATE_WARN_1_ROLE_ID : env.PRIVATE_WARN_2_ROLE_ID;

export async function setupAdminPanel(i: DiscordInteraction, env: Env): Promise<Response> {
  if (!isAdministrator(i) || i.guild_id !== env.PRIVATE_GUILD_ID) return ephemeral("❌ Только Administrator может создать панель.");
  await sendChannelMessage(env, env.PRIVATE_ADMIN_CHANNEL_ID, adminPanel());
  return ephemeral(`✅ Новая админ-панель опубликована в <#${env.PRIVATE_ADMIN_CHANNEL_ID}>.`);
}

export function openUserSelection(i: DiscordInteraction, env: Env, action: "warn" | "member-info" | "blacklist"): Response {
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
  const connect = modalValue(i, "connect")?.trim(); const before = modalValue(i, "gather_before")?.trim(); const comment = modalValue(i, "comment")?.trim();
  if (!project || !wipe || !connect || !before || !["1", "2"].includes(before)) return ephemeral("❌ Заполните все поля; сбор можно выбрать за 1 или 2 часа.");
  const wipeAt = Date.parse(wipe.replace(" ", "T") + ":00+03:00");
  if (!Number.isFinite(wipeAt)) return ephemeral("❌ Формат времени: ГГГГ-ММ-ДД ЧЧ:ММ (МСК).");
  const gatherAt = wipeAt - Number(before) * 3_600_000;
  if (gatherAt <= Date.now()) return ephemeral("❌ Время сбора уже прошло. Укажите будущий вайп.");
  const item = { project, wipeAt, gatherAt, connect, notifyAt: gatherAt, sent: false };
  await env.APPLICATIONS.put(`wipe:${crypto.randomUUID()}`, JSON.stringify(item));
  await sendChannelMessage(env, env.WIPE_CHANNEL_ID, { content: `📢 **Запланирован вайп: ${project}**\nСбор: <t:${Math.floor(gatherAt / 1000)}:F> — за ${before} ч. до вайпа\nВайп: <t:${Math.floor(wipeAt / 1000)}:F>\nПодключение: \`${connect}\`${comment ? `\nДополнительно: ${comment}` : ""}\n\nВ момент сбора бот повторно уведомит всех.` });
  return ephemeral(`✅ Уведомление создано в <#${env.WIPE_CHANNEL_ID}>.`);
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
  for (const key of page.keys) { const item = await env.APPLICATIONS.get<{ project: string; wipeAt: number; gatherAt: number; connect: string; notifyAt: number; sent: boolean }>(key.name, "json");
    if (!item || item.sent || item.notifyAt > Date.now()) continue;
    await sendChannelMessage(env, env.WIPE_CHANNEL_ID, { content: `@everyone 📢 **Скоро сбор на вайп: ${item.project}**\nСбор: <t:${Math.floor(item.gatherAt / 1000)}:R>\nВайп: <t:${Math.floor(item.wipeAt / 1000)}:F>\nПодключение: \`${item.connect}\``, allowed_mentions: { parse: ["everyone"] } });
    item.sent = true; await env.APPLICATIONS.put(key.name, JSON.stringify(item), { expirationTtl: 604800 });
  }
}
