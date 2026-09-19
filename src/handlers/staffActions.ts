import { messages } from "../config/messages";
import { CustomId, applicationEmbed, rejectionModal, staffButtons } from "../discord/components";
import { InteractionResponseType, ephemeral, jsonResponse } from "../discord/interactions";
import { discordRest, sendChannelMessage } from "../discord/rest";
import { isStaff } from "../discord/permissions";
import { closeApplication, getApplicationByChannel, saveAcceptedApplication, saveApplication } from "../storage/applications";
import type { ApplicationRecord, DiscordInteraction, Env } from "../types";
import { logEvent } from "../utils/logger";
import { interactionUser, modalValue } from "./helpers";

async function updateCard(env: Env, app: ApplicationRecord): Promise<void> {
  await discordRest(env, `/channels/${app.ticketChannelId}/messages/${app.cardMessageId}`, {
    method: "PATCH",
    body: JSON.stringify({ embeds: [applicationEmbed(app)], components: staffButtons(true) })
  });
}

async function requireApplication(interaction: DiscordInteraction, env: Env): Promise<ApplicationRecord | null> {
  if (!interaction.channel_id) return null;
  return getApplicationByChannel(env, interaction.channel_id);
}

async function deleteInterviewVoice(env: Env, app: ApplicationRecord): Promise<void> {
  if (!app.voiceChannelId) return;
  await discordRest(env, `/channels/${app.voiceChannelId}`, { method: "DELETE" }).catch(() => undefined);
  delete app.voiceChannelId;
}

function privateOnboardingMessage(inviteUrl: string): string {
  return [
    "✅ **Заявка принята — добро пожаловать в .int!**",
    "",
    "**1.** Зайдите на приватный сервер:",
    inviteUrl,
    "",
    "**2.** Уже на **.int Private** напишите команду:",
    "```",
    "/claim",
    "```",
    "Бот автоматически выдаст вам Rust-роль, роль выбранного направления и установит ник.",
    "Команду нужно выполнить с того же Discord-аккаунта, с которого подавалась заявка."
  ].join("\n");
}

function privateInviteButton(inviteUrl: string): unknown[] {
  return [{ type: 1, components: [{ type: 2, style: 5, label: "Войти на .int Private", emoji: { name: "🔐" }, url: inviteUrl }] }];
}

export async function inviteCandidateToVoice(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (!isStaff(interaction, env)) return ephemeral(messages.noPermission);
  const app = await requireApplication(interaction, env);
  if (!app) return ephemeral("⚠️ Данные заявки не найдены.");
  if (app.status !== "PENDING") return ephemeral(messages.alreadyHandled);
  if (app.voiceChannelId) return ephemeral(`🔊 Голосовой канал уже создан: <#${app.voiceChannelId}>.`);
  const allowVoice = (1024n | 1048576n | 2097152n).toString();
  const staffRoleId = env.STAFF_ROLE_ID;
  const overwrites: Array<Record<string, string | number>> = [
    { id: env.DISCORD_GUILD_ID, type: 0, allow: "0", deny: "1024" },
    { id: app.applicantId, type: 1, allow: allowVoice, deny: "0" },
    { id: env.DISCORD_APPLICATION_ID, type: 1, allow: allowVoice, deny: "0" }
  ];
  if (staffRoleId) overwrites.push({ id: staffRoleId, type: 0, allow: allowVoice, deny: "0" });
  const channel = await discordRest<{ id: string }>(env, `/guilds/${env.DISCORD_GUILD_ID}/channels`, { method: "POST", body: JSON.stringify({
    name: `interview-${app.applicantUsername}`.toLowerCase().replace(/[^a-z0-9а-яё_-]+/gi, "-").slice(0, 90),
    type: 2, parent_id: env.TICKETS_CATEGORY_ID, permission_overwrites: overwrites
  }) });
  app.voiceChannelId = channel.id;
  await saveApplication(env, app);
  await sendChannelMessage(env, app.ticketChannelId, { content: `🔊 <@${app.applicantId}>, вас приглашают на собеседование: <#${channel.id}>.`, allowed_mentions: { users: [app.applicantId] } });
  return ephemeral(`✅ Кандидат приглашён в <#${channel.id}>.`);
}

export async function acceptApplication(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (!isStaff(interaction, env)) return ephemeral(messages.noPermission);
  const app = await requireApplication(interaction, env);
  if (!app) return ephemeral("⚠️ Данные заявки не найдены.");
  if (app.status !== "PENDING") return ephemeral(messages.alreadyHandled);
  const staff = interactionUser(interaction);
  if (!staff) return ephemeral(messages.genericError);

  app.status = "ACCEPTED";
  app.staffId = staff.id;
  app.decidedAt = new Date().toISOString();
  await deleteInterviewVoice(env, app);
  await saveApplication(env, app);
  await saveAcceptedApplication(env, app);
  await updateCard(env, app);
  await discordRest(env, `/guilds/${env.DISCORD_GUILD_ID}/members/${app.applicantId}/roles/${env.PUBLIC_MAIN_ROLE_ID}`, { method: "PUT" });
  await sendChannelMessage(env, app.ticketChannelId, {
    content: `<@${app.applicantId}>\n\n${privateOnboardingMessage(env.PRIVATE_INVITE_URL)}\n\nРешение принял: <@${staff.id}>`,
    components: privateInviteButton(env.PRIVATE_INVITE_URL),
    allowed_mentions: { users: [app.applicantId, staff.id] }
  });
  const dmDelivered = await (async () => {
    try {
      const dm = await discordRest<{ id: string }>(env, "/users/@me/channels", { method: "POST", body: JSON.stringify({ recipient_id: app.applicantId }) });
      await sendChannelMessage(env, dm.id, {
        content: privateOnboardingMessage(env.PRIVATE_INVITE_URL),
        components: privateInviteButton(env.PRIVATE_INVITE_URL)
      });
      return true;
    } catch { return false; }
  })();
  await logEvent(env, "✅ Заявка принята", [
    { name: "Кандидат", value: `<@${app.applicantId}>` },
    { name: "Staff", value: `<@${staff.id}>` },
    { name: "Канал", value: `<#${app.ticketChannelId}>` }
    , { name: "Ссылка в ЛС", value: dmDelivered ? "✅ Отправлена" : "⚠️ ЛС закрыты; ссылка есть в тикете" }
  ], 0x2ecc71);
  return ephemeral("✅ Заявка принята.");
}

export function openRejectModal(interaction: DiscordInteraction, env: Env): Response {
  if (!isStaff(interaction, env)) return ephemeral(messages.noPermission);
  return jsonResponse({ type: InteractionResponseType.Modal, data: rejectionModal() });
}

export async function rejectApplication(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (!isStaff(interaction, env)) return ephemeral(messages.noPermission);
  const app = await requireApplication(interaction, env);
  if (!app) return ephemeral("⚠️ Данные заявки не найдены.");
  if (app.status !== "PENDING") return ephemeral(messages.alreadyHandled);
  const staff = interactionUser(interaction);
  const reason = modalValue(interaction, "reason")?.trim();
  if (!staff || !reason) return ephemeral(messages.invalidData);

  app.status = "REJECTED";
  app.staffId = staff.id;
  app.rejectionReason = reason;
  app.decidedAt = new Date().toISOString();
  await deleteInterviewVoice(env, app);
  await saveApplication(env, app);
  await updateCard(env, app);
  await sendChannelMessage(env, app.ticketChannelId, {
    content: `❌ **Заявка отклонена**\n\n<@${app.applicantId}>, к сожалению, ваша заявка на вступление в .int была отклонена.\n\n**Причина:**\n${reason}\n\nСпасибо за интерес к нашему клану.`,
    allowed_mentions: { users: [app.applicantId] }
  });
  await logEvent(env, "❌ Заявка отклонена", [
    { name: "Кандидат", value: `<@${app.applicantId}>` },
    { name: "Staff", value: `<@${staff.id}>` },
    { name: "Причина", value: reason.slice(0, 1024) },
    { name: "Канал", value: `<#${app.ticketChannelId}>` }
  ], 0xe74c3c);
  return ephemeral("✅ Решение сохранено.");
}

export function confirmClose(interaction: DiscordInteraction, env: Env): Response {
  if (!isStaff(interaction, env)) return ephemeral(messages.noPermission);
  return jsonResponse({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      content: "🔒 **Закрыть тикет?**\n\nВы уверены, что хотите закрыть этот тикет?",
      flags: 64,
      components: [{ type: 1, components: [
        { type: 2, style: 4, label: "Да, закрыть", emoji: { name: "🔒" }, custom_id: CustomId.CloseConfirm },
        { type: 2, style: 2, label: "Отмена", custom_id: CustomId.CloseCancel }
      ] }]
    }
  });
}

export async function closeTicket(interaction: DiscordInteraction, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!isStaff(interaction, env)) return ephemeral(messages.noPermission);
  const app = await requireApplication(interaction, env);
  if (!app) return ephemeral("⚠️ Данные заявки не найдены.");
  const staff = interactionUser(interaction);
  if (!staff) return ephemeral(messages.genericError);

  // Remove all active Discord/Steam indexes before doing optional logging.
  // This guarantees that a failed log request can never block a new application.
  await closeApplication(env, app);
  ctx.waitUntil((async () => {
    await deleteInterviewVoice(env, app);
    await logEvent(env, "🔒 Тикет закрыт", [
      { name: "Кандидат", value: `<@${app.applicantId}> (\`${app.applicantId}\`)` },
      { name: "Staff", value: `<@${staff.id}>` },
      { name: "Канал ID", value: `\`${app.ticketChannelId}\`` },
      { name: "Статус", value: app.status }
    ], 0x95a5a6).catch((error: unknown) => {
      console.error("Ticket close log failed", error instanceof Error ? error.message : "unknown error");
    });
    await discordRest(env, `/channels/${app.ticketChannelId}`, { method: "DELETE" });
  })().catch((error: unknown) => {
    console.error("Ticket close failed", error instanceof Error ? error.message : "unknown error");
  }));
  return jsonResponse({ type: InteractionResponseType.DeferredUpdateMessage });
}

export function cancelClose(): Response {
  return jsonResponse({ type: InteractionResponseType.UpdateMessage, data: { content: "Закрытие отменено.", components: [] } });
}
