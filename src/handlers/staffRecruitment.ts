import { staffApplicationButtons, staffApplicationEmbed, staffApplicationModal, staffApplicationNextButton } from "../discord/components";
import { InteractionResponseType, ephemeral, jsonResponse } from "../discord/interactions";
import { isStaffApplicationReviewer } from "../discord/permissions";
import { discordRest, sendChannelMessage } from "../discord/rest";
import {
  closeStaffApplication, deleteStaffApplicationDraft, getActiveStaffApplication, getRecruitmentState,
  getStaffApplicationByChannel, getStaffApplicationDraft, saveStaffApplication, saveStaffApplicationDraft
} from "../storage/applications";
import type { DiscordInteraction, Env, StaffApplicationAnswers, StaffApplicationDraft, StaffApplicationRecord } from "../types";
import { normalizeChannelName } from "../utils/validation";
import { interactionUser, modalValue } from "./helpers";

const stepFields: Record<1 | 2 | 3, Array<keyof StaffApplicationAnswers>> = {
  1: ["realName", "age", "timezone", "dailyAvailability"],
  2: ["contactHours", "meetings", "adminExperience", "conflictAndRules"],
  3: ["situations", "motivation"]
};

function collectStep(interaction: DiscordInteraction, step: 1 | 2 | 3): Partial<StaffApplicationAnswers> | null {
  const values: Partial<StaffApplicationAnswers> = {};
  for (const key of stepFields[step]) {
    const value = modalValue(interaction, key)?.trim();
    if (!value) return null;
    values[key] = value;
  }
  return values;
}

export async function openStaffApplication(interaction: DiscordInteraction, env: Env): Promise<Response> {
  const user = interactionUser(interaction);
  if (!user) return ephemeral("⚠️ Не удалось определить пользователя.");
  const state = await getRecruitmentState(env);
  if (!state.staffOpen) return ephemeral("🔒 Набор в Discord Staff сейчас закрыт.");
  const active = await getActiveStaffApplication(env, user.id);
  if (active) return ephemeral(`⚠️ У вас уже есть Staff-заявка: <#${active.ticketChannelId}>.`);
  return jsonResponse({ type: InteractionResponseType.Modal, data: staffApplicationModal(1) });
}

export async function saveStaffApplicationStep(interaction: DiscordInteraction, env: Env, step: 1 | 2 | 3, draftId: string): Promise<Response> {
  const user = interactionUser(interaction);
  const answers = collectStep(interaction, step);
  if (!user || !answers) return ephemeral("⚠️ Заполните все поля шага.");
  if (!(await getRecruitmentState(env)).staffOpen) return ephemeral("🔒 Набор в Discord Staff уже закрыт.");
  let draft: StaffApplicationDraft;
  if (step === 1) {
    draft = { id: crypto.randomUUID(), applicantId: user.id, applicantUsername: user.username, answers };
  } else {
    const stored = await getStaffApplicationDraft(env, draftId);
    if (!stored || stored.applicantId !== user.id) return ephemeral("⚠️ Черновик Staff-анкеты истёк. Начните заново.");
    draft = { ...stored, answers: { ...stored.answers, ...answers } };
  }
  if (step < 3) {
    await saveStaffApplicationDraft(env, draft);
    const next = (step + 1) as 2 | 3;
    return jsonResponse({ type: InteractionResponseType.ChannelMessageWithSource, data: {
      content: `✅ Шаг ${step}/3 сохранён.`, components: staffApplicationNextButton(next, draft.id), flags: 64
    } });
  }
  const complete = draft.answers as StaffApplicationAnswers;
  if (Object.values(complete).some(value => !value)) return ephemeral("⚠️ В анкете не хватает ответов. Начните заново.");
  const application = await createStaffTicket(env, user.id, user.username, complete);
  await deleteStaffApplicationDraft(env, draft.id);
  return ephemeral(`✅ Staff-заявка создана: <#${application.ticketChannelId}>.`);
}

export async function openStaffApplicationStep(interaction: DiscordInteraction, env: Env): Promise<Response> {
  const match = /^staff-application:step:([23]):([0-9a-f-]{36})$/i.exec(interaction.data?.custom_id ?? "");
  const user = interactionUser(interaction);
  if (!match || !user) return ephemeral("⚠️ Некорректный шаг анкеты.");
  const stepValue = match[1];
  const draftId = match[2];
  if (!stepValue || !draftId) return ephemeral("⚠️ Некорректный шаг анкеты.");
  const draft = await getStaffApplicationDraft(env, draftId);
  if (!draft || draft.applicantId !== user.id) return ephemeral("⚠️ Черновик Staff-анкеты истёк. Начните заново.");
  return jsonResponse({ type: InteractionResponseType.Modal, data: staffApplicationModal(Number(stepValue) as 2 | 3, draft.id) });
}

async function createStaffTicket(env: Env, userId: string, username: string, answers: StaffApplicationAnswers): Promise<StaffApplicationRecord> {
  const VIEW = 1024n; const SEND = 2048n; const MANAGE = 8192n; const EMBED = 16384n; const ATTACH = 32768n; const HISTORY = 65536n;
  const applicantAllow = VIEW | SEND | EMBED | ATTACH | HISTORY;
  const staffAllow = applicantAllow | MANAGE;
  const overwrites: Array<Record<string, string | number>> = [
    { id: env.DISCORD_GUILD_ID, type: 0, allow: "0", deny: VIEW.toString() },
    { id: userId, type: 1, allow: applicantAllow.toString(), deny: "0" },
    { id: env.STAFF_APPLICATION_ROLE_ID, type: 0, allow: staffAllow.toString(), deny: "0" },
    { id: env.DISCORD_APPLICATION_ID, type: 1, allow: (staffAllow | 16n).toString(), deny: "0" }
  ];
  const channel = await discordRest<{ id: string }>(env, `/guilds/${env.DISCORD_GUILD_ID}/channels`, { method: "POST", body: JSON.stringify({
    name: `staff-${normalizeChannelName(username, userId.slice(-4))}`.slice(0, 95), type: 0, parent_id: env.TICKETS_CATEGORY_ID,
    topic: `.int Staff application | applicant=${userId}`, permission_overwrites: overwrites
  }) });
  const app: StaffApplicationRecord = { applicantId: userId, applicantUsername: username, ticketChannelId: channel.id, cardMessageId: "", status: "PENDING", createdAt: new Date().toISOString(), ...answers };
  try {
    const card = await sendChannelMessage(env, channel.id, {
      content: `<@${userId}> <@&${env.STAFF_APPLICATION_ROLE_ID}>`, embeds: [staffApplicationEmbed(app)], components: staffApplicationButtons(),
      allowed_mentions: { users: [userId], roles: [env.STAFF_APPLICATION_ROLE_ID] }
    });
    app.cardMessageId = card.id;
    await saveStaffApplication(env, app);
    return app;
  } catch (error) {
    await discordRest(env, `/channels/${channel.id}`, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}

async function updateStaffCard(env: Env, app: StaffApplicationRecord): Promise<void> {
  await discordRest(env, `/channels/${app.ticketChannelId}/messages/${app.cardMessageId}`, {
    method: "PATCH", body: JSON.stringify({ embeds: [staffApplicationEmbed(app)], components: staffApplicationButtons(true) })
  });
}

export async function acceptStaffApplication(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (!isStaffApplicationReviewer(interaction, env) || !interaction.channel_id) return ephemeral("❌ Staff-заявки может рассматривать только роль Staff.");
  const app = await getStaffApplicationByChannel(env, interaction.channel_id);
  const staff = interactionUser(interaction);
  if (!app || !staff || app.status !== "PENDING") return ephemeral("⚠️ Staff-заявка не найдена или уже обработана.");
  try {
    await discordRest(env, `/guilds/${env.DISCORD_GUILD_ID}/members/${app.applicantId}/roles/${env.STAFF_APPLICATION_ROLE_ID}`, { method: "PUT" });
  } catch {
    return ephemeral("⚠️ Не удалось выдать роль Staff. Проверьте право Manage Roles и положение роли бота выше роли Staff.");
  }
  app.status = "ACCEPTED"; app.staffId = staff.id; app.decidedAt = new Date().toISOString();
  await saveStaffApplication(env, app); await updateStaffCard(env, app);
  await sendChannelMessage(env, app.ticketChannelId, { content: `✅ <@${app.applicantId}>, ваша заявка в Discord Staff принята. Роль <@&${env.STAFF_APPLICATION_ROLE_ID}> выдана автоматически.`, allowed_mentions: { users: [app.applicantId], roles: [env.STAFF_APPLICATION_ROLE_ID] } });
  return ephemeral("✅ Staff-заявка принята, роль Staff выдана.");
}

export function openStaffRejectModal(interaction: DiscordInteraction, env: Env): Response {
  if (!isStaffApplicationReviewer(interaction, env)) return ephemeral("❌ Staff-заявки может рассматривать только роль Staff.");
  return jsonResponse({ type: InteractionResponseType.Modal, data: { title: "Отклонить Staff-заявку", custom_id: "staff-review:reject-modal", components: [{ type: 1, components: [{ type: 4, custom_id: "reason", label: "Причина", style: 2, required: true, min_length: 2, max_length: 1000 }] }] } });
}

export async function rejectStaffApplication(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (!isStaffApplicationReviewer(interaction, env) || !interaction.channel_id) return ephemeral("❌ Staff-заявки может рассматривать только роль Staff.");
  const app = await getStaffApplicationByChannel(env, interaction.channel_id); const staff = interactionUser(interaction); const reason = modalValue(interaction, "reason")?.trim();
  if (!app || !staff || !reason || app.status !== "PENDING") return ephemeral("⚠️ Staff-заявка не найдена или уже обработана.");
  app.status = "REJECTED"; app.staffId = staff.id; app.rejectionReason = reason; app.decidedAt = new Date().toISOString();
  await saveStaffApplication(env, app); await updateStaffCard(env, app);
  await sendChannelMessage(env, app.ticketChannelId, { content: `❌ <@${app.applicantId}>, Staff-заявка отклонена.\n**Причина:** ${reason}`, allowed_mentions: { users: [app.applicantId] } });
  return ephemeral("✅ Решение сохранено.");
}

export async function closeStaffTicket(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (!isStaffApplicationReviewer(interaction, env) || !interaction.channel_id) return ephemeral("❌ Staff-заявки может рассматривать только роль Staff.");
  const app = await getStaffApplicationByChannel(env, interaction.channel_id);
  if (!app) return ephemeral("⚠️ Staff-заявка не найдена.");
  await closeStaffApplication(env, app);
  await discordRest(env, `/channels/${app.ticketChannelId}`, { method: "DELETE" });
  return ephemeral("✅ Staff-тикет закрыт.");
}
