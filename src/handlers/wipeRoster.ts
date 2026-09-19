import { discordRest } from "../discord/rest";
import type { Env, WipeAttendanceRecord } from "../types";

export interface WipeMember {
  user: { id: string; username: string; global_name?: string; bot?: boolean };
  nick?: string;
  roles: string[];
  joined_at?: string;
}

export async function currentWipeRoster(env: Env): Promise<WipeMember[]> {
  const result: WipeMember[] = [];
  let after = "0";
  for (;;) {
    const page = await discordRest<WipeMember[]>(env, `/guilds/${env.PRIVATE_GUILD_ID}/members?limit=1000&after=${after}`);
    result.push(...page.filter(member => !member.user.bot && member.roles.includes(env.PRIVATE_RUST_ROLE_ID)));
    if (page.length < 1000) return result;
    const last = page.at(-1);
    if (!last) return result;
    after = last.user.id;
  }
}

export function absenceReason(record: WipeAttendanceRecord | null, project: string): string | null {
  if (record?.warningIssuedAt) return null;
  if (record?.rsvp === "no") return null;
  return record?.rsvp ? `Подтвердил участие, но не зашёл на вайп: ${project}` : `Не ответил на приглашение на вайп: ${project}`;
}
