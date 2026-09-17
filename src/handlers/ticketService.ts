import { getStaffRoleId } from "../config/roles";
import { applicationEmbed, staffButtons } from "../discord/components";
import { discordRest, sendChannelMessage } from "../discord/rest";
import { saveApplication } from "../storage/applications";
import type { ApplicationRecord, ApplicationSteamAccount, Env, RoleKey } from "../types";
import { normalizeChannelName } from "../utils/validation";

interface DiscordChannel { id: string }

export interface TicketInput {
  applicantId: string;
  applicantUsername: string;
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
}

export async function createApplicationTicket(env: Env, input: TicketInput): Promise<ApplicationRecord> {
  const VIEW_CHANNEL = 1024n;
  const SEND_MESSAGES = 2048n;
  const MANAGE_MESSAGES = 8192n;
  const EMBED_LINKS = 16384n;
  const ATTACH_FILES = 32768n;
  const READ_MESSAGE_HISTORY = 65536n;
  const applicantAllow = VIEW_CHANNEL | SEND_MESSAGES | EMBED_LINKS | ATTACH_FILES | READ_MESSAGE_HISTORY;
  const staffAllow = applicantAllow | MANAGE_MESSAGES;
  const botAllow = staffAllow | 16n;

  const channel = await discordRest<DiscordChannel>(env, `/guilds/${env.DISCORD_GUILD_ID}/channels`, {
    method: "POST",
    body: JSON.stringify({
      name: normalizeChannelName(input.applicantUsername, input.applicantId.slice(-4)),
      type: 0,
      parent_id: env.TICKETS_CATEGORY_ID,
      topic: `.int application | applicant=${input.applicantId} | steam=${input.steamId64}`,
      permission_overwrites: [
        { id: env.DISCORD_GUILD_ID, type: 0, allow: "0", deny: VIEW_CHANNEL.toString() },
        { id: input.applicantId, type: 1, allow: applicantAllow.toString(), deny: "0" },
        { id: getStaffRoleId(env.STAFF_ROLE_ID), type: 0, allow: staffAllow.toString(), deny: "0" },
        { id: env.DISCORD_APPLICATION_ID, type: 1, allow: botAllow.toString(), deny: "0" }
      ]
    })
  });

  const application: ApplicationRecord = {
    ...input,
    ticketChannelId: channel.id,
    cardMessageId: "",
    status: "PENDING",
    createdAt: new Date().toISOString()
  };

  try {
    const card = await sendChannelMessage(env, channel.id, {
      content: `<@${input.applicantId}> <@&${getStaffRoleId(env.STAFF_ROLE_ID)}>`,
      embeds: [applicationEmbed(application)],
      components: staffButtons(),
      allowed_mentions: { users: [input.applicantId], roles: [getStaffRoleId(env.STAFF_ROLE_ID)] }
    });
    application.cardMessageId = card.id;
    await saveApplication(env, application);
    return application;
  } catch (error) {
    await discordRest(env, `/channels/${channel.id}`, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}
