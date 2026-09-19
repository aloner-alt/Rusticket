import { CustomId, applicationModal, roleSelector, steamAccountsModal, steamStepButton } from "../discord/components";
import { EPHEMERAL, InteractionResponseType, ephemeral, jsonResponse } from "../discord/interactions";
import { DiscordRestError, discordRest } from "../discord/rest";
import { closeApplication, getActiveApplication, getApplicationDraft, saveApplicationDraft } from "../storage/applications";
import type { ApplicationDraft, DiscordInteraction, Env } from "../types";
import { messages } from "../config/messages";
import { isRoleKey } from "../config/requirements";
import { parseStrictInteger } from "../utils/validation";
import { interactionUser, modalValue } from "./helpers";

export async function openApplication(interaction: DiscordInteraction, env: Env): Promise<Response> {
  const user = interactionUser(interaction);
  if (!user) return ephemeral(messages.genericError);
  const active = await getActiveApplication(env, user.id);
  if (active) {
    try {
      await discordRest(env, `/channels/${active.ticketChannelId}`);
      return ephemeral(messages.existingApplication(active.ticketChannelId));
    } catch (error) {
      if (!(error instanceof DiscordRestError) || error.status !== 404) throw error;
      await closeApplication(env, active);
    }
  }
  return jsonResponse({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: { content: "Выберите направление, на которое хотите подать заявку:", components: roleSelector(), flags: EPHEMERAL }
  });
}

export function selectRole(interaction: DiscordInteraction): Response {
  const role = interaction.data?.values?.[0];
  if (!role || !isRoleKey(role)) return ephemeral(messages.invalidData);
  return jsonResponse({ type: InteractionResponseType.Modal, data: applicationModal(role) });
}

export async function saveApplicationDetails(interaction: DiscordInteraction, env: Env, roleValue: string): Promise<Response> {
  const user = interactionUser(interaction);
  if (!user || !isRoleKey(roleValue)) return ephemeral(messages.invalidData);
  const age = parseStrictInteger(modalValue(interaction, "age") ?? "");
  const dailyOnline = parseStrictInteger(modalValue(interaction, "daily_online") ?? "");
  const realName = modalValue(interaction, "real_name")?.trim();
  const applicantComment = modalValue(interaction, "comment")?.trim() || undefined;
  if (age === null || dailyOnline === null || age > 99 || dailyOnline > 24 || !realName) {
    return ephemeral(messages.invalidData);
  }
  const draft: ApplicationDraft = {
    id: crypto.randomUUID(),
    applicantId: user.id,
    applicantUsername: user.username,
    age,
    dailyOnline,
    role: roleValue,
    realName,
    ...(applicantComment ? { applicantComment } : {})
  };
  await saveApplicationDraft(env, draft);
  return jsonResponse({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      content: "✅ Основные данные сохранены. Теперь укажите Steam-аккаунты в отдельных полях. Первый аккаунт будет основным, остальные можно оставить пустыми.",
      components: steamStepButton(draft.id),
      flags: EPHEMERAL
    }
  });
}

export async function openSteamAccounts(interaction: DiscordInteraction, env: Env): Promise<Response> {
  const user = interactionUser(interaction);
  const draftId = interaction.data?.custom_id?.slice(CustomId.SteamStepPrefix.length);
  if (!user || !draftId) return ephemeral(messages.invalidData);
  const draft = await getApplicationDraft(env, draftId);
  if (!draft || draft.applicantId !== user.id) return ephemeral("⚠️ Анкета истекла. Нажмите «Подать заявку» и заполните её заново.");
  return jsonResponse({ type: InteractionResponseType.Modal, data: steamAccountsModal(draft.id) });
}
