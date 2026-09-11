import { messages } from "../config/messages";
import { exceptionModal } from "../discord/components";
import { InteractionResponseType, ephemeral, jsonResponse } from "../discord/interactions";
import { isStaff } from "../discord/permissions";
import {
  banApplicant, deleteRejectedReview, getActiveApplication, getActiveApplicationBySteam,
  getRejectedReview, unbanApplicant
} from "../storage/applications";
import type { DiscordInteraction, Env } from "../types";
import { logEvent } from "../utils/logger";
import { interactionUser, modalValue } from "./helpers";
import { createApplicationTicket } from "./ticketService";

function reviewId(customId: string, prefix: string): string | null {
  const value = customId.slice(prefix.length);
  return /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

export function openExceptionModal(interaction: DiscordInteraction, env: Env): Response {
  if (!isStaff(interaction, env)) return ephemeral(messages.noPermission);
  const id = reviewId(interaction.data?.custom_id ?? "", "review:exception:");
  if (!id) return ephemeral("⚠️ Данные отказа некорректны.");
  return jsonResponse({ type: InteractionResponseType.Modal, data: exceptionModal(id) });
}

export async function createExceptionTicket(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (!isStaff(interaction, env)) return ephemeral(messages.noPermission);
  const id = reviewId(interaction.data?.custom_id ?? "", "review:exception-modal:");
  const staff = interactionUser(interaction);
  const recruiterComment = modalValue(interaction, "recruiter_comment")?.trim();
  if (!id || !staff || !recruiterComment) return ephemeral(messages.invalidData);
  const review = await getRejectedReview(env, id);
  if (!review) return ephemeral("⚠️ Запись отказа устарела или уже обработана.");

  const [activeUser, activeSteam] = await Promise.all([
    getActiveApplication(env, review.applicantId),
    getActiveApplicationBySteam(env, review.steamId64)
  ]);
  if (activeUser) return ephemeral(messages.existingApplication(activeUser.ticketChannelId));
  if (activeSteam) return ephemeral(messages.steamAlreadyUsed);

  await unbanApplicant(env, review.applicantId, review.steamId64);
  const application = await createApplicationTicket(env, {
    applicantId: review.applicantId,
    applicantUsername: review.applicantUsername,
    age: review.age,
    dailyOnline: review.dailyOnline,
    role: review.role,
    steamUrl: review.steamUrl,
    steamId64: review.steamId64,
    rustHours: review.rustHours,
    requiredHours: review.requiredHours,
    ...(review.realName ? { realName: review.realName } : {}),
    ...(review.steamName ? { steamName: review.steamName } : {}),
    ...(review.applicantComment ? { applicantComment: review.applicantComment } : {}),
    manualException: true,
    recruiterComment,
    exceptionStaffId: staff.id
  });
  await deleteRejectedReview(env, id);
  await logEvent(env, "✅ Staff создал тикет-исключение", [
    { name: "Кандидат", value: `<@${review.applicantId}> (\`${review.applicantId}\`)` },
    { name: "Staff", value: `<@${staff.id}>` },
    { name: "Канал", value: `<#${application.ticketChannelId}>` },
    { name: "SteamID64", value: `\`${review.steamId64}\`` },
    { name: "Часы", value: `${review.rustHours} / ${review.requiredHours}` },
    { name: "Комментарий рекрутёра", value: recruiterComment }
  ], 0x2ecc71);
  return ephemeral(`✅ Тикет-исключение создан: <#${application.ticketChannelId}>`);
}

export async function banFromReview(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (!isStaff(interaction, env)) return ephemeral(messages.noPermission);
  const id = reviewId(interaction.data?.custom_id ?? "", "review:ban:");
  const staff = interactionUser(interaction);
  if (!id || !staff) return ephemeral(messages.invalidData);
  const review = await getRejectedReview(env, id);
  if (!review) return ephemeral("⚠️ Запись отказа устарела.");
  await banApplicant(env, review.applicantId, review.steamId64, "Ручная блокировка Staff", staff.id);
  await logEvent(env, "⛔ Блокировка заявки обновлена", [
    { name: "Кандидат", value: `<@${review.applicantId}>` },
    { name: "SteamID64", value: `\`${review.steamId64}\`` },
    { name: "Staff", value: `<@${staff.id}>` },
    { name: "Срок", value: "24 часа" }
  ], 0xe74c3c);
  return ephemeral("⛔ Discord-пользователь и SteamID64 заблокированы на 24 часа.");
}

export async function unbanFromReview(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (!isStaff(interaction, env)) return ephemeral(messages.noPermission);
  const id = reviewId(interaction.data?.custom_id ?? "", "review:unban:");
  const staff = interactionUser(interaction);
  if (!id || !staff) return ephemeral(messages.invalidData);
  const review = await getRejectedReview(env, id);
  if (!review) return ephemeral("⚠️ Запись отказа устарела.");
  await unbanApplicant(env, review.applicantId, review.steamId64);
  await logEvent(env, "🔓 Блокировка снята", [
    { name: "Кандидат", value: `<@${review.applicantId}>` },
    { name: "SteamID64", value: `\`${review.steamId64}\`` },
    { name: "Staff", value: `<@${staff.id}>` }
  ], 0x3498db);
  return ephemeral("🔓 Блокировка Discord-пользователя и SteamID64 снята.");
}
