import { ephemeral } from "../discord/interactions";
import { DiscordRestError, discordRest } from "../discord/rest";
import { deleteAcceptedApplication, getAcceptedApplication, getMemberLink, saveMemberLink } from "../storage/applications";
import type { DiscordInteraction, Env, MemberLink, RoleKey } from "../types";
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

export const NEW_MEMBER_ROLE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export function newMemberRoleExpiresAt(now = Date.now()): number {
  return now + NEW_MEMBER_ROLE_DURATION_MS;
}

export async function expireTrialRoles(env: Env): Promise<void> {
  let cursor: string | undefined;
  const now = Date.now();
  do {
    const page = await env.APPLICATIONS.list({ prefix: "member:", ...(cursor ? { cursor } : {}) });
    for (const key of page.keys) {
      const link = await env.APPLICATIONS.get<MemberLink>(key.name, "json");
      if (!link?.trialRoleExpiresAt || link.trialRoleExpiresAt > now) continue;
      try {
        await discordRest(env, `/guilds/${env.PRIVATE_GUILD_ID}/members/${link.discordUserId}/roles/${env.PRIVATE_NEW_MEMBER_ROLE_ID}`, { method: "DELETE" });
      } catch (error) {
        if (!(error instanceof DiscordRestError) || error.status !== 404) {
          console.error("New member role removal failed", link.discordUserId, error instanceof Error ? error.message : "unknown error");
          continue;
        }
      }
      delete link.trialRoleExpiresAt;
      await saveMemberLink(env, link);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

export async function claimRoles(interaction: DiscordInteraction, env: Env): Promise<Response> {
  const user = interactionUser(interaction);
  if (!user || interaction.guild_id !== env.PRIVATE_GUILD_ID) return ephemeral("❌ Команда доступна только на .int Private.");
  const app = await getAcceptedApplication(env, user.id);
  if (!app || app.status !== "ACCEPTED") return ephemeral("⚠️ Принятая заявка для вашего Discord-аккаунта не найдена.");
  if (!app.steamName || !app.realName) return ephemeral("⚠️ В старой заявке нет имени. Обратитесь к Staff для ручной настройки.");

  const existingLink = await getMemberLink(env, user.id);
  const trialRoleExpiresAt = existingLink?.trialRoleExpiresAt && existingLink.trialRoleExpiresAt > Date.now()
    ? existingLink.trialRoleExpiresAt
    : newMemberRoleExpiresAt();
  await saveMemberLink(env, {
    discordUserId: user.id,
    steamId64: app.steamId64,
    steamUrl: app.steamUrl,
    steamName: app.steamName,
    realName: app.realName,
    role: app.role,
    linkedAt: existingLink?.linkedAt ?? new Date().toISOString(),
    trialRoleExpiresAt
  });

  await Promise.all([
    discordRest(env, `/guilds/${env.PRIVATE_GUILD_ID}/members/${user.id}/roles/${env.PRIVATE_RUST_ROLE_ID}`, { method: "PUT" }),
    discordRest(env, `/guilds/${env.PRIVATE_GUILD_ID}/members/${user.id}/roles/${roleId(env, app.role)}`, { method: "PUT" }),
    discordRest(env, `/guilds/${env.PRIVATE_GUILD_ID}/members/${user.id}/roles/${env.PRIVATE_NEW_MEMBER_ROLE_ID}`, { method: "PUT" })
  ]);
  await discordRest(env, `/guilds/${env.PRIVATE_GUILD_ID}/members/${user.id}`, {
    method: "PATCH",
    body: JSON.stringify({ nick: safeNickname(app.steamName, app.realName) })
  });
  await deleteAcceptedApplication(env, user.id);
  return ephemeral(`✅ Роли и ник выданы. Роль новичка будет снята <t:${Math.floor(trialRoleExpiresAt / 1000)}:R>. SteamID64: \`${app.steamId64}\``);
}
