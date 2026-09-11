import { getStaffRoleId } from "../config/roles";
import type { DiscordInteraction, Env } from "../types";

const ADMINISTRATOR = 1n << 3n;

export function isStaff(interaction: DiscordInteraction, env: Env): boolean {
  const member = interaction.member;
  if (!member) return false;
  const permissions = BigInt(member.permissions ?? "0");
  return (permissions & ADMINISTRATOR) === ADMINISTRATOR || member.roles.includes(getStaffRoleId(env.STAFF_ROLE_ID));
}

export function isAdministrator(interaction: DiscordInteraction): boolean {
  const permissions = BigInt(interaction.member?.permissions ?? "0");
  return (permissions & ADMINISTRATOR) === ADMINISTRATOR;
}

export function isPrivateModerator(interaction: DiscordInteraction, env: Env): boolean {
  return isAdministrator(interaction) || Boolean(interaction.member?.roles.includes(env.PRIVATE_MODERATOR_ROLE_ID));
}
