import { ephemeral } from "../discord/interactions";
import { discordRest } from "../discord/rest";
import { deleteAcceptedApplication, getAcceptedApplication, saveMemberLink } from "../storage/applications";
import type { DiscordInteraction, Env, RoleKey } from "../types";
import { interactionUser } from "./helpers";

function roleId(env: Env, role: RoleKey): string {
  const roles: Record<RoleKey, string> = {
    combat: env.PRIVATE_COMBAT_ROLE_ID,
    farm: env.PRIVATE_FARM_ROLE_ID,
    builder: env.PRIVATE_BUILDER_ROLE_ID,
    industrial: env.PRIVATE_INDUSTRIAL_ROLE_ID,
    electric: env.PRIVATE_ELECTRIC_ROLE_ID,
    pilot: env.PRIVATE_PILOT_ROLE_ID
  };
  return roles[role];
}

function safeNickname(steamName: string, realName: string): string {
  return `${steamName} | ${realName}`.replace(/[\r\n]/g, " ").trim().slice(0, 32);
}

export async function claimRoles(interaction: DiscordInteraction, env: Env): Promise<Response> {
  const user = interactionUser(interaction);
  if (!user || interaction.guild_id !== env.PRIVATE_GUILD_ID) return ephemeral("❌ Команда доступна только на .int Private.");
  const app = await getAcceptedApplication(env, user.id);
  if (!app || app.status !== "ACCEPTED") return ephemeral("⚠️ Принятая заявка для вашего Discord-аккаунта не найдена.");
  if (!app.steamName || !app.realName) return ephemeral("⚠️ В старой заявке нет имени. Обратитесь к Staff для ручной настройки.");

  await Promise.all([
    discordRest(env, `/guilds/${env.PRIVATE_GUILD_ID}/members/${user.id}/roles/${env.PRIVATE_RUST_ROLE_ID}`, { method: "PUT" }),
    discordRest(env, `/guilds/${env.PRIVATE_GUILD_ID}/members/${user.id}/roles/${roleId(env, app.role)}`, { method: "PUT" })
  ]);
  await discordRest(env, `/guilds/${env.PRIVATE_GUILD_ID}/members/${user.id}`, {
    method: "PATCH",
    body: JSON.stringify({ nick: safeNickname(app.steamName, app.realName) })
  });
  await saveMemberLink(env, {
    discordUserId: user.id,
    steamId64: app.steamId64,
    steamUrl: app.steamUrl,
    steamName: app.steamName,
    realName: app.realName,
    role: app.role,
    linkedAt: new Date().toISOString()
  });
  await deleteAcceptedApplication(env, user.id);
  return ephemeral(`✅ Роли и ник выданы. SteamID64: \`${app.steamId64}\``);
}
