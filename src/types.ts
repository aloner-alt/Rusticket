export interface Env {
  DISCORD_APPLICATION_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_GUILD_ID: string;
  STEAM_API_KEY: string;
  TICKETS_CHANNEL_ID: string;
  TICKETS_CATEGORY_ID: string;
  LOG_CHANNEL_ID: string;
  STAFF_ROLE_ID?: string;
  PRIVATE_INVITE_URL: string;
  PUBLIC_MAIN_ROLE_ID: string;
  PRIVATE_GUILD_ID: string;
  PRIVATE_ADMIN_CHANNEL_ID: string;
  BLACKLIST_CHANNEL_ID: string;
  PRIVATE_RUST_ROLE_ID: string;
  PRIVATE_NEW_MEMBER_ROLE_ID: string;
  PRIVATE_COMBAT_ROLE_ID: string;
  PRIVATE_FARM_ROLE_ID: string;
  PRIVATE_BUILDER_ROLE_ID: string;
  PRIVATE_INDUSTRIAL_ROLE_ID: string;
  PRIVATE_ELECTRIC_ROLE_ID: string;
  PRIVATE_PILOT_ROLE_ID: string;
  PRIVATE_MODERATOR_ROLE_ID: string;
  PRIVATE_WARN_1_ROLE_ID: string;
  PRIVATE_WARN_2_ROLE_ID: string;
  PUNISHMENT_CATEGORY_ID: string;
  WIPE_CHANNEL_ID: string;
  RUST_SERVER_CONNECT: string;
  MONITORING_SERVER_ID: string;
  PLAYER_CHECK_CHANNEL_ID: string;
  APPLICATIONS: KVNamespace;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
}

export interface DiscordMember {
  user?: DiscordUser;
  roles: string[];
  permissions?: string;
}

export interface InteractionDataOption {
  name: string;
  type: number;
  value?: string | number | boolean;
}

export interface InteractionComponent {
  type: number;
  custom_id?: string;
  value?: string;
  values?: string[];
  components?: InteractionComponent[];
}

export interface DiscordInteraction {
  id: string;
  application_id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  member?: DiscordMember;
  user?: DiscordUser;
  message?: { id: string; embeds?: DiscordEmbed[] };
  data?: {
    name?: string;
    custom_id?: string;
    values?: string[];
    options?: InteractionDataOption[];
    components?: InteractionComponent[];
  };
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

export type RoleKey = "combat" | "farm" | "builder" | "industrial" | "electric" | "pilot";
export type ApplicationStatus = "PENDING" | "ACCEPTED" | "REJECTED";

export interface ApplicationSteamAccount {
  steamUrl: string;
  steamId64: string;
  steamName?: string;
  rustHours?: number;
  dataHidden?: boolean;
}

export interface ApplicationRecord {
  applicantId: string;
  applicantUsername: string;
  ticketChannelId: string;
  cardMessageId: string;
  voiceChannelId?: string;
  age: number;
  dailyOnline: number;
  role: RoleKey;
  steamUrl: string;
  steamId64: string;
  steamAccounts?: ApplicationSteamAccount[];
  rustHours: number;
  requiredHours: number;
  realName?: string;
  steamName?: string;
  steamDataHidden?: boolean;
  inventoryStatus?: "OK" | "PRIVATE" | "ERROR";
  inventoryItemCount?: number;
  inventoryValueRub?: number;
  inventoryPricedUnique?: number;
  inventoryTotalUnique?: number;
  inventoryLimited?: boolean;
  applicantComment?: string;
  manualException?: boolean;
  recruiterComment?: string;
  exceptionStaffId?: string;
  status: ApplicationStatus;
  createdAt: string;
  decidedAt?: string;
  staffId?: string;
  rejectionReason?: string;
  onboardingDeliveredAt?: string;
  onboardingAttempts?: number;
}

export interface ApplicationDraft {
  id: string;
  applicantId: string;
  applicantUsername: string;
  age: number;
  dailyOnline: number;
  role: RoleKey;
  realName: string;
  applicantComment?: string;
}

export interface BanRecord {
  expiresAt: number;
  reason: string;
  staffId?: string;
}

export interface RejectedReview {
  id: string;
  applicantId: string;
  applicantUsername: string;
  age: number;
  dailyOnline: number;
  role: RoleKey;
  steamUrl: string;
  steamId64: string;
  rustHours: number;
  requiredHours: number;
  realName?: string;
  steamName?: string;
  applicantComment?: string;
  rejectionReason: string;
  createdAt: string;
}

export interface MemberLink {
  discordUserId: string;
  steamId64: string;
  steamUrl: string;
  steamName: string;
  realName: string;
  role: RoleKey;
  linkedAt: string;
  trialRoleExpiresAt?: number;
}

export interface WarningEntry {
  level: 1 | 2;
  reason: string;
  moderatorId: string;
  issuedAt: number;
  expiresAt: number;
  channelId?: string;
}

export interface WarningRecord {
  userId: string;
  channelId: string;
  warnings: WarningEntry[];
}

export interface RustServerConfig {
  label: string;
  connect: string;
  monitoringId: string;
  publicMessageId?: string;
}
