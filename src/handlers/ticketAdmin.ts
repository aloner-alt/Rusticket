import { InteractionResponseType, ephemeral, jsonResponse } from "../discord/interactions";
import { isPrivateModerator } from "../discord/permissions";
import { DiscordRestError, discordRest, sendChannelMessage } from "../discord/rest";
import { closeApplication, getApplicationByChannel, getRecruitmentState, saveRecruitmentState } from "../storage/applications";
import type { ApplicationRecord, DiscordInteraction, Env } from "../types";
import { logEvent } from "../utils/logger";
import { interactionUser, modalValue } from "./helpers";

const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const TICKET_ADMIN_PANEL_KEY = "ticket-admin:panel-message-id";

export async function ensureTicketAdminPanel(env: Env): Promise<void> {
  if (await env.APPLICATIONS.get(TICKET_ADMIN_PANEL_KEY)) return;
  const message = await sendChannelMessage(env, env.PRIVATE_ADMIN_CHANNEL_ID, {
    content: "📋 **Админ-панель заявок .int**\nУправление игровым набором, отдельным набором в Discord Staff, зависшими тикетами и критериями ролей.",
    components: [{ type: 1, components: [{ type: 2, style: 1, label: "Открыть панель заявок", custom_id: "admin:recruitment-toggle" }] }]
  });
  await env.APPLICATIONS.put(TICKET_ADMIN_PANEL_KEY, message.id);
}

function authorized(interaction: DiscordInteraction, env: Env): boolean {
  return interaction.guild_id === env.PRIVATE_GUILD_ID && isPrivateModerator(interaction, env);
}

export async function openTicketAdmin(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (!authorized(interaction, env)) return ephemeral("❌ Управление заявками доступно только Staff привата.");
  const state = await getRecruitmentState(env);
  const criteria = Object.entries(state.additionalCriteria ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string").map(([role, question]) => {
    if (!isRoleKey(role)) return `• **${role}:** ${question}`;
    return `${ROLE_REQUIREMENTS[role].emoji} **${ROLE_REQUIREMENTS[role].label}:** ${question}`;
  }).join("\n") || "не заданы";
  return jsonResponse({ type: InteractionResponseType.ChannelMessageWithSource, data: {
    content: [
      "🛡️ **Панель заявок .int**",
      `Набор: **${state.open ? "открыт" : "закрыт"}**.`,
      "Принятые тикеты закрываются автоматически через **1 час** — время не меняем.",
      "Зависшие заявки можно просмотреть и закрыть **по одной**, с подтверждением.",
      `Набор Discord Staff: **${state.staffOpen ? "открыт" : "закрыт"}**.`,
      `Дополнительные критерии по ролям:\n${criteria}`
    ].join("\n"),
    flags: 64,
    components: [{ type: 1, components: [
      { type: 2, style: state.open ? 4 : 3, label: state.open ? "Закрыть набор" : "Открыть набор", custom_id: "ticket:toggle" },
      { type: 2, style: state.staffOpen ? 4 : 3, label: state.staffOpen ? "Закрыть Staff-набор" : "Открыть Staff-набор", custom_id: "ticket:staff-toggle" },
      { type: 2, style: 2, label: "Зависшие тикеты", custom_id: "ticket:stale" },
      { type: 2, style: 1, label: "Добавить дополнительные критерии", custom_id: "ticket:criteria" },
      { type: 2, style: 2, label: "Убрать критерий", custom_id: "ticket:criteria-remove", disabled: !Object.keys(state.additionalCriteria ?? {}).length }
    ] }]
  } });
}

export function selectCriteriaRole(interaction: DiscordInteraction, env: Env, action: "set" | "remove"): Response {
  if (!authorized(interaction, env)) return ephemeral("❌ Недостаточно прав.");
  return jsonResponse({ type: InteractionResponseType.ChannelMessageWithSource, data: {
    content: action === "set" ? "Выберите игровую роль для дополнительного критерия:" : "Выберите роль, у которой нужно убрать критерий:",
    components: criteriaRoleSelector(action), flags: 64
  } });
}

export function openAdditionalQuestionModal(interaction: DiscordInteraction, env: Env): Response {
  if (!authorized(interaction, env)) return ephemeral("❌ Недостаточно прав.");
  const role = interaction.data?.values?.[0];
  if (!role || !isRoleKey(role)) return ephemeral("⚠️ Роль не выбрана.");
  return jsonResponse({ type: InteractionResponseType.Modal, data: {
    title: `Критерий: ${ROLE_REQUIREMENTS[role].label}`,
    custom_id: `ticket:criteria-modal:${role}`,
    components: [{ type: 1, components: [{
      type: 4, custom_id: "question", label: "Что спросить у кандидата?", style: 1,
      placeholder: "Например: в какое время обычно играете?", required: true, min_length: 2, max_length: 45
    }] }]
  } });
}

export async function saveAdditionalQuestion(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (!authorized(interaction, env)) return ephemeral("❌ Недостаточно прав.");
  const role = interaction.data?.custom_id?.slice("ticket:criteria-modal:".length);
  if (!role || !isRoleKey(role)) return ephemeral("⚠️ Роль не определена.");
  const question = modalValue(interaction, "question")?.trim().replace(/[\r\n\t]/g, " ");
  if (!question || question.length < 2 || question.length > 45) return ephemeral("⚠️ Вопрос должен содержать от 2 до 45 символов.");
  const state = await getRecruitmentState(env);
  await saveRecruitmentState(env, { ...state, additionalCriteria: { ...state.additionalCriteria, [role]: question } });
  return ephemeral(`✅ Для **${ROLE_REQUIREMENTS[role].label}** добавлен обязательный критерий: **${question}**. Ответ будет виден в тикете.`);
}

export async function removeAdditionalQuestion(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (!authorized(interaction, env)) return ephemeral("❌ Недостаточно прав.");
  const role = interaction.data?.values?.[0];
  if (!role || !isRoleKey(role)) return ephemeral("⚠️ Роль не выбрана.");
  const state = await getRecruitmentState(env);
  if (!state.additionalCriteria?.[role]) return ephemeral(`У роли **${ROLE_REQUIREMENTS[role].label}** дополнительного критерия нет.`);
  const remainingCriteria = Object.fromEntries(Object.entries(state.additionalCriteria).filter(([key]) => key !== role));
  await saveRecruitmentState(env, { ...state, additionalCriteria: remainingCriteria });
  return ephemeral(`✅ Дополнительный критерий для **${ROLE_REQUIREMENTS[role].label}** удалён из новых анкет.`);
}

async function staleReason(env: Env, app: ApplicationRecord): Promise<string | null> {
  try {
    await discordRest(env, `/channels/${app.ticketChannelId}`);
  } catch (error) {
    if (error instanceof DiscordRestError && error.status === 404) return "канал уже удалён";
    throw error;
  }
  const createdAt = Date.parse(app.createdAt);
  return Number.isFinite(createdAt) && Date.now() - createdAt >= STALE_AFTER_MS ? "старше 48 часов" : null;
}

export async function showStaleTickets(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (!authorized(interaction, env)) return ephemeral("❌ Недостаточно прав.");
  const tickets: Array<{ app: ApplicationRecord; reason: string }> = [];
  let cursor: string | undefined;
  let scanned = 0;
  do {
    const page = await env.APPLICATIONS.list({ prefix: "active:", ...(cursor ? { cursor } : {}) });
    for (const key of page.keys) {
      const app = await env.APPLICATIONS.get<ApplicationRecord>(key.name, "json");
      if (!app) continue;
      scanned++;
      const reason = await staleReason(env, app);
      if (reason) tickets.push({ app, reason });
      if (tickets.length >= 25 || scanned >= 100) break;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && tickets.length < 25 && scanned < 100);
  if (!tickets.length) return ephemeral("✅ Среди проверенных заявок зависших тикетов нет.");
  const lines = tickets.map(({ app, reason }, index) => `${index + 1}. <@${app.applicantId}> — <#${app.ticketChannelId}> · ${app.status} · ${reason}`);
  return jsonResponse({ type: InteractionResponseType.ChannelMessageWithSource, data: {
    content: `🧹 **Зависшие тикеты**\n${lines.join("\n")}\n\nВыберите один тикет для закрытия. Просмотрены первые ${scanned} записей.`,
    flags: 64,
    components: [{ type: 1, components: [{
      type: 3, custom_id: "ticket:stale-select", placeholder: "Выбрать тикет для закрытия", min_values: 1, max_values: 1,
      options: tickets.map(({ app, reason }) => ({ label: `${app.applicantUsername.slice(0, 65)} · ${app.status}`, value: app.ticketChannelId, description: reason }))
    }] }]
  } });
}

export async function confirmStaleTicket(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (!authorized(interaction, env)) return ephemeral("❌ Недостаточно прав.");
  const channelId = interaction.data?.values?.[0];
  if (!channelId || !/^\d{17,20}$/.test(channelId)) return ephemeral("⚠️ Тикет не выбран.");
  const app = await getApplicationByChannel(env, channelId);
  if (!app || !(await staleReason(env, app))) return ephemeral("⚠️ Тикет уже закрыт или больше не считается зависшим.");
  return jsonResponse({ type: InteractionResponseType.ChannelMessageWithSource, data: {
    content: `⚠️ Удалить тикет <#${channelId}> кандидата <@${app.applicantId}>? Активная заявка и Steam-блокировки по этой заявке будут сняты.`,
    flags: 64,
    components: [{ type: 1, components: [{ type: 2, style: 4, label: "Да, закрыть тикет", custom_id: `ticket:stale-confirm:${channelId}` }] }]
  } });
}

export async function closeStaleTicket(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (!authorized(interaction, env)) return ephemeral("❌ Недостаточно прав.");
  const channelId = interaction.data?.custom_id?.slice("ticket:stale-confirm:".length);
  if (!channelId || !/^\d{17,20}$/.test(channelId)) return ephemeral("⚠️ Некорректный тикет.");
  const app = await getApplicationByChannel(env, channelId);
  if (!app || !(await staleReason(env, app))) return ephemeral("⚠️ Тикет уже закрыт или больше не считается зависшим.");
  try {
    await discordRest(env, `/channels/${channelId}`, { method: "DELETE" });
  } catch (error) {
    if (!(error instanceof DiscordRestError) || error.status !== 404) throw error;
  }
  await closeApplication(env, app);
  if (app.voiceChannelId) await discordRest(env, `/channels/${app.voiceChannelId}`, { method: "DELETE" }).catch(() => undefined);
  const staff = interactionUser(interaction);
  await logEvent(env, "🧹 Зависший тикет закрыт вручную", [
    { name: "Кандидат", value: `<@${app.applicantId}>` },
    { name: "Тикет", value: `\`${channelId}\`` },
    { name: "Staff", value: staff ? `<@${staff.id}>` : "неизвестен" }
  ], 0x95a5a6).catch(() => undefined);
  return ephemeral(`✅ Тикет <#${channelId}> закрыт. Кандидат может подать новую заявку.`);
}
import { ROLE_REQUIREMENTS, isRoleKey } from "../config/requirements";
import { criteriaRoleSelector } from "../discord/components";
