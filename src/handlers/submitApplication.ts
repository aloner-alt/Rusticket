import { messages } from "../config/messages";
import { MINIMUM_AGE, MINIMUM_DAILY_ONLINE, ROLE_REQUIREMENTS, isRoleKey } from "../config/requirements";
import { ageRejectionActions, reviewActions } from "../discord/components";
import { DiscordRestError, discordRest, editOriginalResponse } from "../discord/rest";
import { verifySteamProfile } from "../steam/steamClient";
import { estimateRustInventory } from "../steam/inventory";
import {
  banApplicant, closeApplication, getActiveApplication, getActiveApplicationBySteam, getSteamBan,
  getUserBan, isCoolingDown, saveRejectedReview
} from "../storage/applications";
import type { DiscordInteraction, Env, RejectedReview } from "../types";
import { logEvent } from "../utils/logger";
import { parseStrictInteger } from "../utils/validation";
import { interactionUser, modalValue } from "./helpers";
import { createApplicationTicket } from "./ticketService";

async function finish(env: Env, token: string, content: string): Promise<void> {
  await editOriginalResponse(env, token, { content, components: [] });
}

function remainingHours(expiresAt: number): number {
  return Math.max(1, Math.ceil((expiresAt - Date.now()) / 3_600_000));
}

async function isLiveApplication(env: Env, app: Awaited<ReturnType<typeof getActiveApplication>>): Promise<boolean> {
  if (!app) return false;
  try {
    await discordRest(env, `/channels/${app.ticketChannelId}`);
    return true;
  } catch (error) {
    if (!(error instanceof DiscordRestError) || error.status !== 404) throw error;
    await closeApplication(env, app);
    return false;
  }
}

async function rejectAndLog(
  env: Env,
  interaction: DiscordInteraction,
  content: string,
  reason: string,
  details: Array<{ name: string; value: string }> = [],
  ban = false,
  steamId64?: string,
  components?: unknown[]
): Promise<void> {
  const user = interactionUser(interaction);
  if (ban && user) await banApplicant(env, user.id, steamId64, reason);
  await finish(env, interaction.token, ban ? `${content}\n\n⛔ Повторная подача заблокирована на **24 часа**.` : content);
  await logEvent(env, "Автоматический результат заявки", [
    { name: "Кандидат", value: user ? `<@${user.id}> (\`${user.id}\`)` : "Неизвестен" },
    { name: "Результат", value: reason },
    ...(ban ? [{ name: "Блокировка", value: "Discord и доступный SteamID: 24 часа" }] : []),
    ...details
  ], 0xe67e22, components);
}

export async function submitApplication(interaction: DiscordInteraction, env: Env, roleValue: string): Promise<void> {
  const user = interactionUser(interaction);
  if (!user || !isRoleKey(roleValue)) {
    await finish(env, interaction.token, messages.invalidData);
    return;
  }

  const userBan = await getUserBan(env, user.id);
  if (userBan) {
    await finish(env, interaction.token, messages.applicationBanned(remainingHours(userBan.expiresAt)));
    return;
  }
  if (await isCoolingDown(env, user.id)) {
    await finish(env, interaction.token, messages.cooldown);
    return;
  }

  const previousApplication = await getActiveApplication(env, user.id);
  if (previousApplication && await isLiveApplication(env, previousApplication)) {
    await finish(env, interaction.token, messages.existingApplication(previousApplication.ticketChannelId));
    return;
  }

  const age = parseStrictInteger(modalValue(interaction, "age") ?? "");
  const dailyOnline = parseStrictInteger(modalValue(interaction, "daily_online") ?? "");
  const steamInput = modalValue(interaction, "steam") ?? "";
  const realName = modalValue(interaction, "real_name")?.trim();
  const applicantComment = modalValue(interaction, "comment")?.trim() || undefined;
  if (age === null || dailyOnline === null || age > 99 || dailyOnline > 24 || !realName) {
    await rejectAndLog(env, interaction, messages.invalidData, "Некорректные данные формы");
    return;
  }
  if (age < MINIMUM_AGE) {
    await rejectAndLog(
      env,
      interaction,
      messages.insufficientAge,
      "Недостаточный возраст",
      [{ name: "Возраст", value: String(age) }],
      true,
      undefined,
      ageRejectionActions(user.id)
    );
    return;
  }
  if (dailyOnline < MINIMUM_DAILY_ONLINE) {
    await rejectAndLog(env, interaction, messages.insufficientOnline(dailyOnline), "Недостаточный онлайн", [{ name: "Онлайн", value: `${dailyOnline} ч./сутки` }], true);
    return;
  }

  const steam = await verifySteamProfile(steamInput, env.STEAM_API_KEY);
  if (!steam.ok && steam.reason === "PRIVATE_GAMES" && steam.steamId64 && steam.profileUrl) {
    const [steamBan, existingSteam] = await Promise.all([
      getSteamBan(env, steam.steamId64), getActiveApplicationBySteam(env, steam.steamId64)
    ]);
    if (steamBan) { await finish(env, interaction.token, messages.applicationBanned(remainingHours(steamBan.expiresAt))); return; }
    if (await isLiveApplication(env, existingSteam)) { await finish(env, interaction.token, messages.steamAlreadyUsed); return; }
    const requirement = ROLE_REQUIREMENTS[roleValue]; const inventory = await estimateRustInventory(env, steam.steamId64);
    const application = await createApplicationTicket(env, {
      applicantId: user.id, applicantUsername: user.username, age, dailyOnline, role: roleValue,
      steamUrl: steam.profileUrl, steamId64: steam.steamId64,
      rustHours: 0, requiredHours: requirement.minimumRustHours, realName, steamDataHidden: true,
      inventoryStatus: inventory.status,
      ...(inventory.itemCount !== undefined ? { inventoryItemCount: inventory.itemCount } : {}),
      ...(inventory.valueRub !== undefined ? { inventoryValueRub: inventory.valueRub } : {}),
      ...(inventory.pricedUnique !== undefined ? { inventoryPricedUnique: inventory.pricedUnique } : {}),
      ...(inventory.totalUnique !== undefined ? { inventoryTotalUnique: inventory.totalUnique } : {}),
      ...(inventory.limited !== undefined ? { inventoryLimited: inventory.limited } : {}),
      ...(steam.steamName ? { steamName: steam.steamName } : {}),
      ...(applicantComment ? { applicantComment } : {})
    });
    await finish(env, interaction.token, `✅ **Заявка создана**\n\nДанные об играх и часах Steam скрыты, поэтому заявку вручную рассмотрит Staff.\n\nВаш тикет: <#${application.ticketChannelId}>`);
    await logEvent(env, "⚠️ Создан тикет со скрытыми данными Steam", [
      { name: "Кандидат", value: `<@${user.id}> (\`${user.id}\`)` }, { name: "Канал", value: `<#${application.ticketChannelId}>` },
      { name: "Steam", value: `[Профиль](${steam.profileUrl})` }, { name: "SteamID64", value: `\`${steam.steamId64}\`` },
      { name: "Решение", value: "Игры/часы скрыты — принять или отклонить вручную" }
    ], 0xf1c40f);
    return;
  }
  if (!steam.ok) {
    const content = steam.reason === "PRIVATE_GAMES" ? messages.privateSteam
      : steam.reason === "RUST_NOT_FOUND" ? messages.rustNotFound
      : steam.reason === "API_ERROR" ? messages.genericError
      : messages.invalidSteam;
    await rejectAndLog(env, interaction, content, `Steam: ${steam.reason}`, [
      { name: "Steam URL", value: steamInput.slice(0, 1000) || "Не указан" },
      ...(steam.steamId64 ? [{ name: "SteamID64", value: `\`${steam.steamId64}\`` }] : [])
    ], steam.reason === "RUST_NOT_FOUND", steam.steamId64);
    return;
  }

  const steamBan = await getSteamBan(env, steam.steamId64);
  if (steamBan) {
    await finish(env, interaction.token, messages.applicationBanned(remainingHours(steamBan.expiresAt)));
    return;
  }

  const existingSteam = await getActiveApplicationBySteam(env, steam.steamId64);
  if (await isLiveApplication(env, existingSteam)) {
    await finish(env, interaction.token, messages.steamAlreadyUsed);
    return;
  }

  const requirement = ROLE_REQUIREMENTS[roleValue];
  if (steam.rustHours < requirement.minimumRustHours) {
    await banApplicant(env, user.id, steam.steamId64, "Недостаточно часов Rust");
    const review: RejectedReview = {
      id: crypto.randomUUID(), applicantId: user.id, applicantUsername: user.username,
      age, dailyOnline, role: roleValue, steamUrl: steam.profileUrl,
      steamId64: steam.steamId64, rustHours: steam.rustHours,
      requiredHours: requirement.minimumRustHours,
      realName,
      steamName: steam.steamName,
      ...(applicantComment ? { applicantComment } : {}),
      rejectionReason: "Недостаточно часов Rust", createdAt: new Date().toISOString()
    };
    await saveRejectedReview(env, review);
    await finish(env, interaction.token, `${messages.insufficientHours(requirement.label, requirement.minimumRustHours, steam.rustHours)}\n\n⛔ Повторная подача заблокирована на **24 часа**.`);
    await logEvent(env, "⚠️ Автоматический отказ — доступно исключение", [
      { name: "Кандидат", value: `<@${user.id}> (\`${user.id}\`)` },
      { name: "Steam", value: `[Профиль](${steam.profileUrl})` },
      { name: "SteamID64", value: `\`${steam.steamId64}\`` },
      { name: "Направление", value: requirement.label },
      { name: "Часы", value: `${steam.rustHours} / ${requirement.minimumRustHours}` },
      { name: "Онлайн", value: `${dailyOnline} ч./сутки` },
      ...(applicantComment ? [{ name: "Комментарий кандидата", value: applicantComment }] : []),
      { name: "Блокировка", value: "Discord ID и SteamID64 на 24 часа" }
    ], 0xe67e22, reviewActions(review.id));
    return;
  }

  const inventory = await estimateRustInventory(env, steam.steamId64);
  const application = await createApplicationTicket(env, {
    applicantId: user.id, applicantUsername: user.username, age, dailyOnline,
    role: roleValue, steamUrl: steam.profileUrl, steamId64: steam.steamId64,
    rustHours: steam.rustHours, requiredHours: requirement.minimumRustHours,
    realName, steamName: steam.steamName,
    inventoryStatus: inventory.status,
    ...(inventory.itemCount !== undefined ? { inventoryItemCount: inventory.itemCount } : {}),
    ...(inventory.valueRub !== undefined ? { inventoryValueRub: inventory.valueRub } : {}),
    ...(inventory.pricedUnique !== undefined ? { inventoryPricedUnique: inventory.pricedUnique } : {}),
    ...(inventory.totalUnique !== undefined ? { inventoryTotalUnique: inventory.totalUnique } : {}),
    ...(inventory.limited !== undefined ? { inventoryLimited: inventory.limited } : {}),
    ...(applicantComment ? { applicantComment } : {})
  });
  await finish(env, interaction.token, messages.applicationCreated(application.ticketChannelId));
  await logEvent(env, "✅ Тикет заявки создан", [
    { name: "Кандидат", value: `<@${user.id}> (\`${user.id}\`)` },
    { name: "Канал", value: `<#${application.ticketChannelId}>` },
    { name: "Steam", value: `[Профиль](${steam.profileUrl})` },
    { name: "SteamID64", value: `\`${steam.steamId64}\`` },
    { name: "Rust", value: `${steam.rustHours} ч.` },
    { name: "Направление", value: `${requirement.label} (${requirement.minimumRustHours} ч.)` },
    { name: "Онлайн", value: `${dailyOnline} ч./сутки` },
    ...(applicantComment ? [{ name: "Комментарий кандидата", value: applicantComment }] : [])
  ], 0x2ecc71);
}
