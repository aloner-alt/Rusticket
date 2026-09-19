import { messages } from "../config/messages";
import { exceptionModal } from "../discord/components";
import { InteractionResponseType, ephemeral, jsonResponse } from "../discord/interactions";
import { editOriginalResponse } from "../discord/rest";
import { isStaff } from "../discord/permissions";
import {
  banApplicant, deleteRejectedReview, getActiveApplication, getActiveApplicationBySteam,
  getRejectedReview, getSteamBan, unbanApplicant
} from "../storage/applications";
import type { DiscordInteraction, Env } from "../types";
import { logEvent } from "../utils/logger";
import { interactionUser, modalValue } from "./helpers";
import { createApplicationTicket } from "./ticketService";
import { acceptApplicationRecord } from "./staffActions";

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
    ...(review.steamAccounts ? { steamAccounts: review.steamAccounts } : {}),
    rustHours: review.rustHours,
    requiredHours: review.requiredHours,
    ...(review.realName ? { realName: review.realName } : {}),
    ...(review.steamName ? { steamName: review.steamName } : {}),
    ...(review.steamDataHidden ? { steamDataHidden: true } : {}),
    ...(review.inventoryStatus ? { inventoryStatus: review.inventoryStatus } : {}),
    ...(review.inventoryItemCount !== undefined ? { inventoryItemCount: review.inventoryItemCount } : {}),
    ...(review.inventoryValueRub !== undefined ? { inventoryValueRub: review.inventoryValueRub } : {}),
    ...(review.inventoryPricedUnique !== undefined ? { inventoryPricedUnique: review.inventoryPricedUnique } : {}),
    ...(review.inventoryTotalUnique !== undefined ? { inventoryTotalUnique: review.inventoryTotalUnique } : {}),
    ...(review.inventoryLimited !== undefined ? { inventoryLimited: review.inventoryLimited } : {}),
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

export async function acceptAgeException(interaction: DiscordInteraction, env: Env): Promise<void> {
  if (!isStaff(interaction, env)) {
    await editOriginalResponse(env, interaction.token, { content: messages.noPermission, components: [] });
    return;
  }
  const id = reviewId(interaction.data?.custom_id ?? "", "review:age-accept:");
  const staff = interactionUser(interaction);
  if (!id || !staff) {
    await editOriginalResponse(env, interaction.token, { content: messages.invalidData, components: [] });
    return;
  }
  const review = await getRejectedReview(env, id);
  if (!review || review.rejectionReason !== "Недостаточный возраст") {
    await editOriginalResponse(env, interaction.token, { content: "⚠️ Запись отказа устарела или уже обработана.", components: [] });
    return;
  }
  const activeUser = await getActiveApplication(env, review.applicantId);
  if (activeUser) {
    await editOriginalResponse(env, interaction.token, { content: messages.existingApplication(activeUser.ticketChannelId), components: [] });
    return;
  }
  for (const steamId64 of review.steamAccounts?.map((account) => account.steamId64) ?? [review.steamId64]) {
    const [activeSteam, steamBan] = await Promise.all([getActiveApplicationBySteam(env, steamId64), getSteamBan(env, steamId64)]);
    if (activeSteam) {
      await editOriginalResponse(env, interaction.token, { content: messages.steamAlreadyUsed, components: [] });
      return;
    }
    if (steamBan && steamId64 !== review.steamId64) {
      await editOriginalResponse(env, interaction.token, { content: "⛔ Один из дополнительных Steam-аккаунтов сейчас заблокирован.", components: [] });
      return;
    }
  }
  await unbanApplicant(env, review.applicantId, review.steamId64);
  const application = await createApplicationTicket(env, {
    applicantId: review.applicantId,
    applicantUsername: review.applicantUsername,
    age: review.age,
    dailyOnline: review.dailyOnline,
    role: review.role,
    steamUrl: review.steamUrl,
    steamId64: review.steamId64,
    ...(review.steamAccounts ? { steamAccounts: review.steamAccounts } : {}),
    rustHours: review.rustHours,
    requiredHours: review.requiredHours,
    ...(review.realName ? { realName: review.realName } : {}),
    steamName: review.steamName ?? review.applicantUsername,
    ...(review.steamDataHidden ? { steamDataHidden: true } : {}),
    ...(review.inventoryStatus ? { inventoryStatus: review.inventoryStatus } : {}),
    ...(review.inventoryItemCount !== undefined ? { inventoryItemCount: review.inventoryItemCount } : {}),
    ...(review.inventoryValueRub !== undefined ? { inventoryValueRub: review.inventoryValueRub } : {}),
    ...(review.inventoryPricedUnique !== undefined ? { inventoryPricedUnique: review.inventoryPricedUnique } : {}),
    ...(review.inventoryTotalUnique !== undefined ? { inventoryTotalUnique: review.inventoryTotalUnique } : {}),
    ...(review.inventoryLimited !== undefined ? { inventoryLimited: review.inventoryLimited } : {}),
    ...(review.applicantComment ? { applicantComment: review.applicantComment } : {}),
    manualException: true,
    recruiterComment: "Прямое принятие Staff — исключение по возрасту",
    exceptionStaffId: staff.id
  });
  const onboardingDelivered = await acceptApplicationRecord(env, application, staff.id);
  await deleteRejectedReview(env, id);
  await editOriginalResponse(env, interaction.token, {
    content: onboardingDelivered
      ? `✅ Кандидат принят как исключение. Ссылка на приват и команда /claim отправлены в <#${application.ticketChannelId}>.`
      : `✅ Кандидат принят как исключение. Инструкция будет повторно отправлена автоматически. Тикет: <#${application.ticketChannelId}>.`,
    components: []
  });
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

export async function unbanUserFromLog(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (!isStaff(interaction, env)) return ephemeral(messages.noPermission);
  const prefix = "review:user-unban:";
  const applicantId = (interaction.data?.custom_id ?? "").slice(prefix.length);
  const staff = interactionUser(interaction);
  if (!/^\d{17,20}$/.test(applicantId) || !staff) return ephemeral(messages.invalidData);

  await unbanApplicant(env, applicantId);
  await logEvent(env, "🔓 Блокировка подачи заявки снята", [
    { name: "Кандидат", value: `<@${applicantId}> (\`${applicantId}\`)` },
    { name: "Staff", value: `<@${staff.id}>` },
    { name: "Тип", value: "Временная блокировка Discord ID" }
  ], 0x3498db);
  return ephemeral(`🔓 Блокировка подачи заявки для <@${applicantId}> снята.`);
}
