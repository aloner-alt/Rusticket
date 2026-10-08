import { CustomId, recruitmentPanel, staffRecruitmentPanel } from "../discord/components";
import { ephemeral } from "../discord/interactions";
import { isPrivateModerator } from "../discord/permissions";
import { DiscordRestError, discordRest } from "../discord/rest";
import { getRecruitmentState, saveRecruitmentState } from "../storage/applications";
import type { DiscordInteraction, Env } from "../types";
import { logEvent } from "../utils/logger";
import { interactionUser } from "./helpers";

export const RECRUITMENT_CLOSED_MESSAGE = "🔒 Набор в клан сейчас закрыт. Дождитесь объявления об открытии набора.";

const CRITERIA_PANEL_SYNC_KEY = "recruitment:criteria-panel:2026-09-28-telegram";
const STAFF_REOPEN_KEY = "recruitment:staff-reopened:2026-09-26-v1";
const STAFF_PANEL_ID_KEY = "recruitment:staff-panel-message-id";
const STAFF_PANEL_DEDUPE_KEY = "recruitment:staff-panel-dedupe:2026-10-08-v1";

type ChannelMessage = { id: string; author?: { id: string }; components?: Array<{ components?: Array<{ custom_id?: string }> }> };

async function findStaffRecruitmentPanels(env: Env): Promise<ChannelMessage[]> {
  const panels: ChannelMessage[] = [];
  let before: string | undefined;
  for (let page = 0; page < 20; page++) {
    const messages = await discordRest<ChannelMessage[]>(env, `/channels/${env.TICKETS_CHANNEL_ID}/messages?limit=100${before ? `&before=${before}` : ""}`);
    panels.push(...messages.filter(message => message.author?.id === env.DISCORD_APPLICATION_ID &&
      message.components?.some(row => row.components?.some(component => component.custom_id === "staff-application:open"))));
    if (messages.length < 100) break;
    before = messages.at(-1)?.id;
  }
  return panels;
}

async function saveStaffPanelId(env: Env, id: string): Promise<void> {
  // Keep the ID separate: other cron jobs also write recruitment:state.
  await env.APPLICATIONS.put(STAFF_PANEL_ID_KEY, id);
  const current = await getRecruitmentState(env);
  if (current.staffPanelMessageId !== id) await saveRecruitmentState(env, { ...current, staffPanelMessageId: id });
}

async function adoptStaffRecruitmentPanel(env: Env, open: boolean, removeDuplicates: boolean): Promise<boolean> {
  const panels = await findStaffRecruitmentPanels(env);
  // Discord returns newest first. Preserve the original post and remove only
  // our own exact Staff application panels, never other messages in the channel.
  const keeper = panels.at(-1);
  if (!keeper) return false;
  await discordRest(env, `/channels/${env.TICKETS_CHANNEL_ID}/messages/${keeper.id}`, {
    method: "PATCH", body: JSON.stringify(staffRecruitmentPanel(open))
  });
  await saveStaffPanelId(env, keeper.id);
  if (removeDuplicates) {
    for (const duplicate of panels.slice(0, -1)) {
      try {
        await discordRest(env, `/channels/${env.TICKETS_CHANNEL_ID}/messages/${duplicate.id}`, { method: "DELETE" });
      } catch (error) {
        if (!(error instanceof DiscordRestError && error.status === 404)) throw error;
      }
    }
  }
  return true;
}

export async function ensureStaffRecruitmentPanel(env: Env): Promise<void> {
  let state = await getRecruitmentState(env);
  // One-time recovery requested by the owner after the Staff form was left closed.
  if (!(await env.APPLICATIONS.get(STAFF_REOPEN_KEY))) {
    state = { ...state, staffOpen: true, updatedAt: Date.now() };
    await saveRecruitmentState(env, state);
    await env.APPLICATIONS.put(STAFF_REOPEN_KEY, "done");
  }
  const open = state.staffOpen ?? true;
  // Clean up posts created by older versions once. A failed scan or delete is
  // retried next run and must never cause another POST.
  if (!(await env.APPLICATIONS.get(STAFF_PANEL_DEDUPE_KEY))) {
    const found = await adoptStaffRecruitmentPanel(env, open, true);
    await env.APPLICATIONS.put(STAFF_PANEL_DEDUPE_KEY, "done");
    if (found) return;
  }
  const messageId = await env.APPLICATIONS.get(STAFF_PANEL_ID_KEY) ?? state.staffPanelMessageId;
  if (messageId) {
    try {
      await discordRest(env, `/channels/${env.TICKETS_CHANNEL_ID}/messages/${messageId}`, {
        method: "PATCH", body: JSON.stringify(staffRecruitmentPanel(open))
      });
      await saveStaffPanelId(env, messageId);
      return;
    } catch (error) {
      // Rate limits, outages and network errors are temporary, not evidence
      // that the panel disappeared. Never repost for those failures.
      if (!(error instanceof DiscordRestError && error.status === 404)) throw error;
    }
  }
  if (await adoptStaffRecruitmentPanel(env, open, false)) return;
  const message = await discordRest<{ id: string }>(env, `/channels/${env.TICKETS_CHANNEL_ID}/messages`, {
    method: "POST", body: JSON.stringify(staffRecruitmentPanel(open))
  });
  await saveStaffPanelId(env, message.id);
}

async function findRecruitmentPanelMessageId(env: Env): Promise<string | null> {
  type ChannelMessage = { id: string; author?: { id: string }; components?: Array<{ components?: Array<{ custom_id?: string }> }> };
  let before: string | undefined;
  for (let page = 0; page < 20; page++) {
    const messages = await discordRest<ChannelMessage[]>(env, `/channels/${env.TICKETS_CHANNEL_ID}/messages?limit=100${before ? `&before=${before}` : ""}`);
    const panel = messages.find(message => message.author?.id === env.DISCORD_APPLICATION_ID &&
      message.components?.some(row => row.components?.some(component => component.custom_id === CustomId.Open)));
    if (panel) return panel.id;
    if (messages.length < 100) break;
    before = messages.at(-1)?.id;
  }
  return null;
}

export async function refreshRecruitmentCriteriaPanel(env: Env): Promise<void> {
  if (await env.APPLICATIONS.get(CRITERIA_PANEL_SYNC_KEY)) return;
  const state = await getRecruitmentState(env);
  const panelMessageId = state.panelMessageId ?? await findRecruitmentPanelMessageId(env);
  if (!panelMessageId) return;
  await discordRest(env, `/channels/${env.TICKETS_CHANNEL_ID}/messages/${panelMessageId}`, {
    method: "PATCH", body: JSON.stringify(recruitmentPanel(state.open, env.TELEGRAM_TICKET_BOT_URL))
  });
  if (state.panelMessageId !== panelMessageId) await saveRecruitmentState(env, { ...state, panelMessageId });
  await env.APPLICATIONS.put(CRITERIA_PANEL_SYNC_KEY, "done");
}

export async function toggleRecruitment(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (interaction.guild_id !== env.PRIVATE_GUILD_ID || !isPrivateModerator(interaction, env)) return ephemeral("❌ Управлять набором может только Staff привата.");
  const staff = interactionUser(interaction);
  const current = await getRecruitmentState(env);
  const next = { ...current, open: !current.open, updatedAt: Date.now(), ...(staff ? { updatedBy: staff.id } : {}) };
  await saveRecruitmentState(env, next);
  if (next.panelMessageId) {
    await discordRest(env, `/channels/${env.TICKETS_CHANNEL_ID}/messages/${next.panelMessageId}`, {
      method: "PATCH", body: JSON.stringify(recruitmentPanel(next.open, env.TELEGRAM_TICKET_BOT_URL))
    }).catch((error: unknown) => {
      console.error("Recruitment panel update failed", error instanceof Error ? error.message : "unknown error");
    });
  }
  await logEvent(env, next.open ? "Набор открыт" : "Набор закрыт", [
    { name: "Изменил", value: staff ? `<@${staff.id}>` : "Staff" },
    { name: "Статус", value: next.open ? "✅ Новые заявки принимаются" : "🔒 Новые заявки остановлены" }
  ], next.open ? 0x2ecc71 : 0xe74c3c);
  return ephemeral(next.open
    ? "✅ Набор открыт. Новые кандидаты снова могут подавать заявки."
    : "🔒 Набор закрыт. Новые анкеты и ранее открытые незавершённые формы заблокированы; существующие тикеты продолжают работать.");
}

export async function toggleStaffRecruitment(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (interaction.guild_id !== env.PRIVATE_GUILD_ID || !isPrivateModerator(interaction, env)) return ephemeral("❌ Управлять Staff-набором может только Staff привата.");
  const staff = interactionUser(interaction);
  const current = await getRecruitmentState(env);
  const next = { ...current, staffOpen: !current.staffOpen, updatedAt: Date.now(), ...(staff ? { updatedBy: staff.id } : {}) };
  await saveRecruitmentState(env, next);
  const messageId = await env.APPLICATIONS.get(STAFF_PANEL_ID_KEY) ?? next.staffPanelMessageId;
  try {
    if (messageId) {
      await discordRest(env, `/channels/${env.TICKETS_CHANNEL_ID}/messages/${messageId}`, {
        method: "PATCH", body: JSON.stringify(staffRecruitmentPanel(next.staffOpen))
      });
      await saveStaffPanelId(env, messageId);
    } else {
      await ensureStaffRecruitmentPanel(env);
    }
  } catch (error) {
    if (error instanceof DiscordRestError && error.status === 404) {
      await ensureStaffRecruitmentPanel(env);
    } else {
      // The saved status will be synchronized by cron once Discord recovers.
      console.error("Staff recruitment panel update failed", error instanceof Error ? error.message : "unknown error");
    }
  }
  await logEvent(env, next.staffOpen ? "Набор в Discord Staff открыт" : "Набор в Discord Staff закрыт", [
    { name: "Изменил", value: staff ? `<@${staff.id}>` : "Staff" },
    { name: "Статус", value: next.staffOpen ? "✅ Staff-заявки принимаются" : "🔒 Staff-заявки остановлены" }
  ], next.staffOpen ? 0x5865f2 : 0xe74c3c);
  return ephemeral(next.staffOpen ? "✅ Набор в Discord Staff открыт." : "🔒 Набор в Discord Staff закрыт.");
}
