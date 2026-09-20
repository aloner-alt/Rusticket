import { COOLDOWN_SECONDS } from "../config/requirements";
import type { ApplicationDraft, ApplicationRecord, BanRecord, Env, MemberLink, RejectedReview, RustServerConfig, WarningRecord } from "../types";

const applicantKey = (userId: string) => `active:${userId}`;
const channelKey = (channelId: string) => `channel:${channelId}`;
const cooldownKey = (userId: string) => `cooldown:${userId}`;
const steamActiveKey = (steamId64: string) => `steam-active:${steamId64}`;
const userBanKey = (userId: string) => `ban:user:${userId}`;
const steamBanKey = (steamId64: string) => `ban:steam:${steamId64}`;
const reviewKey = (id: string) => `review:${id}`;
const memberKey = (userId: string) => `member:${userId}`;
const warningKey = (userId: string) => `warning:${userId}`;
const acceptedKey = (userId: string) => `accepted:${userId}`;
const draftKey = (id: string) => `draft:${id}`;
const SERVER_CONFIG_KEY = "rust-server:primary";
const RECRUITMENT_STATE_KEY = "recruitment:state";

export interface RecruitmentState {
  open: boolean;
  updatedAt?: number;
  updatedBy?: string;
  panelMessageId?: string;
}

export async function getRecruitmentState(env: Env): Promise<RecruitmentState> {
  return await env.APPLICATIONS.get<RecruitmentState>(RECRUITMENT_STATE_KEY, "json") ?? { open: true };
}

export function saveRecruitmentState(env: Env, state: RecruitmentState): Promise<void> {
  return env.APPLICATIONS.put(RECRUITMENT_STATE_KEY, JSON.stringify(state));
}

export async function isCoolingDown(env: Env, userId: string): Promise<boolean> {
  const key = cooldownKey(userId);
  const now = Date.now();
  const previous = Number(await env.APPLICATIONS.get(key));
  if (Number.isFinite(previous) && now - previous < COOLDOWN_SECONDS * 1000) return true;
  await env.APPLICATIONS.put(key, String(now), { expirationTtl: 60 });
  return false;
}

export async function getActiveApplication(env: Env, userId: string): Promise<ApplicationRecord | null> {
  return env.APPLICATIONS.get<ApplicationRecord>(applicantKey(userId), "json");
}

export async function getApplicationByChannel(env: Env, channelId: string): Promise<ApplicationRecord | null> {
  return env.APPLICATIONS.get<ApplicationRecord>(channelKey(channelId), "json");
}

export async function getActiveApplicationBySteam(env: Env, steamId64: string): Promise<ApplicationRecord | null> {
  return env.APPLICATIONS.get<ApplicationRecord>(steamActiveKey(steamId64), "json");
}

async function getValidBan(env: Env, key: string): Promise<BanRecord | null> {
  const ban = await env.APPLICATIONS.get<BanRecord>(key, "json");
  if (!ban) return null;
  if (ban.expiresAt > Date.now()) return ban;
  await env.APPLICATIONS.delete(key);
  return null;
}

export function getUserBan(env: Env, userId: string): Promise<BanRecord | null> {
  return getValidBan(env, userBanKey(userId));
}

export function getSteamBan(env: Env, steamId64: string): Promise<BanRecord | null> {
  return getValidBan(env, steamBanKey(steamId64));
}

export async function banApplicant(env: Env, userId: string, steamId64: string | undefined, reason: string, staffId?: string): Promise<void> {
  const ban: BanRecord = {
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    reason,
    ...(staffId ? { staffId } : {})
  };
  const value = JSON.stringify(ban);
  await Promise.all([
    env.APPLICATIONS.put(userBanKey(userId), value, { expirationTtl: 86400 }),
    ...(steamId64 ? [env.APPLICATIONS.put(steamBanKey(steamId64), value, { expirationTtl: 86400 })] : [])
  ]);
}

export async function unbanApplicant(env: Env, userId: string, steamId64?: string): Promise<void> {
  await Promise.all([
    env.APPLICATIONS.delete(userBanKey(userId)),
    ...(steamId64 ? [env.APPLICATIONS.delete(steamBanKey(steamId64))] : [])
  ]);
}

export async function saveRejectedReview(env: Env, review: RejectedReview): Promise<void> {
  await env.APPLICATIONS.put(reviewKey(review.id), JSON.stringify(review), { expirationTtl: 172800 });
}

export function getRejectedReview(env: Env, id: string): Promise<RejectedReview | null> {
  return env.APPLICATIONS.get<RejectedReview>(reviewKey(id), "json");
}

export function deleteRejectedReview(env: Env, id: string): Promise<void> {
  return env.APPLICATIONS.delete(reviewKey(id));
}

export function saveMemberLink(env: Env, link: MemberLink): Promise<void> {
  return env.APPLICATIONS.put(memberKey(link.discordUserId), JSON.stringify(link));
}

export function getMemberLink(env: Env, userId: string): Promise<MemberLink | null> {
  return env.APPLICATIONS.get<MemberLink>(memberKey(userId), "json");
}

export function saveAcceptedApplication(env: Env, application: ApplicationRecord): Promise<void> {
  return env.APPLICATIONS.put(acceptedKey(application.applicantId), JSON.stringify(application), { expirationTtl: 2_592_000 });
}

export function getAcceptedApplication(env: Env, userId: string): Promise<ApplicationRecord | null> {
  return env.APPLICATIONS.get<ApplicationRecord>(acceptedKey(userId), "json");
}

export function deleteAcceptedApplication(env: Env, userId: string): Promise<void> {
  return env.APPLICATIONS.delete(acceptedKey(userId));
}

export function saveApplicationDraft(env: Env, draft: ApplicationDraft): Promise<void> {
  return env.APPLICATIONS.put(draftKey(draft.id), JSON.stringify(draft), { expirationTtl: 900 });
}

export function getApplicationDraft(env: Env, id: string): Promise<ApplicationDraft | null> {
  return env.APPLICATIONS.get<ApplicationDraft>(draftKey(id), "json");
}

export function deleteApplicationDraft(env: Env, id: string): Promise<void> {
  return env.APPLICATIONS.delete(draftKey(id));
}

export function getRustServerConfig(env: Env): Promise<RustServerConfig | null> {
  return env.APPLICATIONS.get<RustServerConfig>(SERVER_CONFIG_KEY, "json");
}

export function saveRustServerConfig(env: Env, config: RustServerConfig): Promise<void> {
  return env.APPLICATIONS.put(SERVER_CONFIG_KEY, JSON.stringify(config));
}

export function getWarningRecord(env: Env, userId: string): Promise<WarningRecord | null> {
  return env.APPLICATIONS.get<WarningRecord>(warningKey(userId), "json");
}

export function saveWarningRecord(env: Env, record: WarningRecord): Promise<void> {
  return env.APPLICATIONS.put(warningKey(record.userId), JSON.stringify(record));
}

export function deleteWarningRecord(env: Env, userId: string): Promise<void> {
  return env.APPLICATIONS.delete(warningKey(userId));
}

export async function saveApplication(env: Env, application: ApplicationRecord): Promise<void> {
  const json = JSON.stringify(application);
  const steamIds = application.steamAccounts?.map((account) => account.steamId64) ?? [application.steamId64];
  await Promise.all([
    env.APPLICATIONS.put(applicantKey(application.applicantId), json),
    env.APPLICATIONS.put(channelKey(application.ticketChannelId), json),
    ...steamIds.map((steamId64) => env.APPLICATIONS.put(steamActiveKey(steamId64), json))
  ]);
}

export async function closeApplication(env: Env, application: ApplicationRecord): Promise<void> {
  const steamIds = application.steamAccounts?.map((account) => account.steamId64) ?? [application.steamId64];
  await Promise.all([
    env.APPLICATIONS.delete(applicantKey(application.applicantId)),
    env.APPLICATIONS.delete(channelKey(application.ticketChannelId)),
    ...steamIds.map((steamId64) => env.APPLICATIONS.delete(steamActiveKey(steamId64)))
  ]);
}
