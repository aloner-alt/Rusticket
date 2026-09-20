import { isAdministrator } from "../discord/permissions";
import { ephemeral } from "../discord/interactions";
import { discordRest, sendChannelMessage } from "../discord/rest";
import type { DiscordInteraction, Env } from "../types";

// Messaging, reactions, invitations, threads and voice connection.
export const GUEST_BLOCK = [0, 6, 11, 12, 18, 20, 21, 35, 36, 38, 46, 49].reduce((bits, bit) => bits | (1n << BigInt(bit)), 0n);
interface Overwrite { id: string; type: number; allow: string; deny: string }
interface Channel { id: string; type: number; permission_overwrites?: Overwrite[] }
interface Role { id: string; permissions: string }
interface Backup { channels: Channel[]; roles: Role[]; completed: string[]; entryId?: string }

export function protectedOverwrites(channel: Channel, guildId: string, roles: Role[], rustId: string, moderatorId: string, botId: string): Overwrite[] {
  const rows = (channel.permission_overwrites ?? []).map(row => ({ ...row }));
  const everyone = rows.find(row => row.id === guildId && row.type === 0) ?? { id: guildId, type: 0, allow: "0", deny: "0" };
  const base = BigInt(roles.find(role => role.id === guildId)?.permissions ?? "0");
  // Preserve existing effective access for Rust and moderator roles, including read-only channels.
  for (const id of new Set([rustId, moderatorId])) {
    const previous = rows.find(row => row.id === id && row.type === 0) ?? { id, type: 0, allow: "0", deny: "0" };
    const permissions = base | BigInt(roles.find(role => role.id === id)?.permissions ?? "0");
    const effective = (((permissions & ~BigInt(everyone.deny)) | BigInt(everyone.allow)) & ~BigInt(previous.deny)) | BigInt(previous.allow);
    const updated = { ...previous, allow: (BigInt(previous.allow) | (effective & GUEST_BLOCK)).toString() };
    const index = rows.findIndex(row => row.id === id && row.type === 0);
    if (index < 0) rows.push(updated); else rows[index] = updated;
  }
  const bot = rows.find(row => row.id === botId && row.type === 1) ?? { id: botId, type: 1, allow: "0", deny: "0" };
  const botUpdated = { ...bot, allow: (BigInt(bot.allow) | 2048n).toString(), deny: (BigInt(bot.deny) & ~2048n).toString() };
  const botIndex = rows.findIndex(row => row.id === botId && row.type === 1);
  if (botIndex < 0) rows.push(botUpdated); else rows[botIndex] = botUpdated;
  const updated = { ...everyone, allow: (BigInt(everyone.allow) & ~GUEST_BLOCK).toString(), deny: (BigInt(everyone.deny) | GUEST_BLOCK).toString() };
  const index = rows.findIndex(row => row.id === guildId && row.type === 0);
  if (index < 0) rows.push(updated); else rows[index] = updated;
  return rows;
}

export async function enablePrivateProtection(i: DiscordInteraction, env: Env): Promise<Response> {
  if (i.guild_id !== env.PRIVATE_GUILD_ID || !isAdministrator(i)) return ephemeral("❌ Включить защиту может только администратор привата.");
  const key = `private-protection:${env.PRIVATE_GUILD_ID}`;
  let backup = await env.APPLICATIONS.get<Backup>(key, "json");
  if (!backup) {
    const [channels, roles] = await Promise.all([
      discordRest<Channel[]>(env, `/guilds/${env.PRIVATE_GUILD_ID}/channels`),
      discordRest<Role[]>(env, `/guilds/${env.PRIVATE_GUILD_ID}/roles`)
    ]);
    if (!roles.some(role => role.id === env.PRIVATE_RUST_ROLE_ID)) return ephemeral("Роль Rust не найдена. Настройки не изменены.");
    backup = { channels, roles, completed: [] };
    await env.APPLICATIONS.put(key, JSON.stringify(backup));
  }
  if (!backup.entryId) {
    const entry = await discordRest<Channel>(env, `/guilds/${env.PRIVATE_GUILD_ID}/channels`, { method: "POST", body: JSON.stringify({
      name: "получить-роли", type: 0,
      permission_overwrites: [
        { id: env.PRIVATE_GUILD_ID, type: 0, allow: (1024n | 65536n | 2147483648n).toString(), deny: GUEST_BLOCK.toString() },
        { id: env.DISCORD_APPLICATION_ID, type: 1, allow: "3072", deny: "0" }
      ]
    }) });
    backup.entryId = entry.id;
    await env.APPLICATIONS.put(key, JSON.stringify(backup));
    await sendChannelMessage(env, entry.id, { content: "Добро пожаловать в .int Private! Общение доступно участникам с ролями. Если вашу заявку приняли, нажмите «Получить роли». Бот проверит принятую заявку и выдаст роли и ник.", components: [{ type: 1, components: [{ type: 2, style: 3, label: "Получить роли", custom_id: "private:claim" }] }] });
  }
  let count = 0;
  // Small resumable batches stay within the interaction background-work window.
  for (const channel of backup.channels.filter(channel => !backup.completed.includes(channel.id)).slice(0, 10)) {
    const permissions = protectedOverwrites(channel, env.PRIVATE_GUILD_ID, backup.roles, env.PRIVATE_RUST_ROLE_ID, env.PRIVATE_MODERATOR_ROLE_ID, env.DISCORD_APPLICATION_ID);
    await discordRest(env, `/channels/${channel.id}`, { method: "PATCH", body: JSON.stringify({ permission_overwrites: permissions }) });
    backup.completed.push(channel.id);
    await env.APPLICATIONS.put(key, JSON.stringify(backup));
    count++;
  }
  const remaining = backup.channels.length - backup.completed.length;
  return ephemeral(remaining
    ? `Защищено ${backup.completed.length}/${backup.channels.length} каналов (+${count}). Нажмите «Защита от гостей» ещё раз для следующих каналов. Канал входа: <#${backup.entryId}>.`
    : `✅ Защита установлена на ${backup.completed.length} каналах. Люди без ролей не могут писать, создавать ветки, приглашения, реакции или подключаться к войсу. Получение ролей: <#${backup.entryId}>. Новые каналы создавайте в защищённых категориях. Индивидуальные разрешения и разрешающие другие роли могут давать исключения.`);
}
