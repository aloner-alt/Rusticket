import { editOriginalResponse } from "../discord/rest";
import { inspectPlayer } from "../steam/playerInspection";
import type { PlayerInspection } from "../steam/playerInspection";
import { isPrivateModerator } from "../discord/permissions";
import { getMemberLink } from "../storage/applications";
import type { DiscordEmbed, DiscordEmbedField, DiscordInteraction, Env } from "../types";

function option(interaction: DiscordInteraction, name: string): string | null {
  const value = interaction.data?.options?.find((item) => item.name === name)?.value;
  return typeof value === "string" ? value : null;
}

function findStat(stats: Array<{ name: string; value: number }> | undefined, patterns: string[]): number | undefined {
  const item = stats?.find((stat) => patterns.some((pattern) => stat.name.toLowerCase() === pattern));
  return item?.value;
}

export async function checkPlayer(interaction: DiscordInteraction, env: Env): Promise<void> {
  if (interaction.channel_id !== env.PLAYER_CHECK_CHANNEL_ID) {
    await editOriginalResponse(env, interaction.token, { content: `❌ Команда доступна только в <#${env.PLAYER_CHECK_CHANNEL_ID}>.` }); return;
  }
  const input = option(interaction, "steam"); if (!input) { await editOriginalResponse(env, interaction.token, { content: "❌ Укажите SteamID64 или ссылку Steam." }); return; }
  const player = await inspectPlayer(env, input);
  if (!player) { await editOriginalResponse(env, interaction.token, { content: "❌ Steam-профиль не найден. Проверьте SteamID64 или ссылку." }); return; }
  await editOriginalResponse(env, interaction.token, { embeds: [playerEmbed(player)] });
}

export function playerEmbed(player: PlayerInspection): DiscordEmbed {
  const bans = player.bans; const visible = player.summary.communityvisibilitystate === 3;
  const created = player.summary.timecreated ? `<t:${player.summary.timecreated}:D> (<t:${player.summary.timecreated}:R>)` : "Скрыто";
  const inventory = player.inventory.status === "OK" ? `≈ **${(player.inventory.valueRub ?? 0).toLocaleString("ru-RU")} ₽** (${player.inventory.itemCount ?? 0} предметов)` : player.inventory.status === "PRIVATE" ? "🔒 Скрыт" : "⚠️ Недоступен";
  const fields: DiscordEmbedField[] = [
    { name: "Steam", value: `[${player.summary.personaname}](${player.summary.profileurl})` }, { name: "SteamID64", value: `\`${player.steamId64}\``, inline: true },
    { name: "Аккаунт создан", value: created, inline: true }, { name: "Профиль", value: visible ? "Публичный" : "Скрыт/ограничен", inline: true },
    { name: "Rust", value: player.rustHours === undefined ? "Скрыто" : `${player.rustHours.toLocaleString("ru-RU")} ч.`, inline: true },
    { name: "За 2 недели", value: player.rustRecentHours === undefined ? "Скрыто" : `${player.rustRecentHours.toLocaleString("ru-RU")} ч.`, inline: true },
    { name: "VAC / игровые баны", value: bans ? `${bans.NumberOfVACBans} / ${bans.NumberOfGameBans}` : "Недоступно", inline: true },
    { name: "Последний бан", value: bans && (bans.NumberOfVACBans || bans.NumberOfGameBans) ? `${bans.DaysSinceLastBan} дн. назад` : "Нет", inline: true },
    { name: "Community / Economy", value: bans ? `${bans.CommunityBanned ? "Да" : "Нет"} / ${bans.EconomyBan}` : "Недоступно", inline: true },
    { name: "Инвентарь Rust", value: inventory }
  ];
  const kills = findStat(player.stats, ["kill_player", "kills"]); const deaths = findStat(player.stats, ["deaths", "death"]);
  if (kills !== undefined || deaths !== undefined) fields.push({ name: "Rust-статистика", value: `Убийства: ${kills ?? "—"}\nСмерти: ${deaths ?? "—"}${kills !== undefined && deaths ? `\nK/D: ${(kills / deaths).toFixed(2)}` : ""}` });
  return { title: "📊 Статистика игрока клана", color: 0x5865f2, fields, footer: { text: "Данные Steam и Rust" }, timestamp: new Date().toISOString() };
}

export async function checkClanPlayer(interaction: DiscordInteraction, env: Env): Promise<void> {
  if (!isPrivateModerator(interaction, env)) { await editOriginalResponse(env, interaction.token, { content: "❌ Недостаточно прав." }); return; }
  const userId = interaction.data?.values?.[0]; if (!userId) { await editOriginalResponse(env, interaction.token, { content: "❌ Пользователь не выбран." }); return; }
  const link = await getMemberLink(env, userId); if (!link) { await editOriginalResponse(env, interaction.token, { content: `⚠️ Для <@${userId}> Steam-привязка не найдена. Пользователь должен выполнить \`/claim\`.` }); return; }
  const player = await inspectPlayer(env, link.steamId64); if (!player) { await editOriginalResponse(env, interaction.token, { content: "❌ Steam-профиль не найден." }); return; }
  const embed = playerEmbed(player); embed.title = `📊 ${link.steamName} | ${link.realName}`;
  await editOriginalResponse(env, interaction.token, { content: `Участник: <@${userId}>`, embeds: [embed] });
}
