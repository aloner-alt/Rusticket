import { applicationModal, roleSelector } from "../discord/components";
import { EPHEMERAL, InteractionResponseType, ephemeral, jsonResponse } from "../discord/interactions";
import { DiscordRestError, discordRest } from "../discord/rest";
import { closeApplication, getActiveApplication } from "../storage/applications";
import type { DiscordInteraction, Env } from "../types";
import { messages } from "../config/messages";
import { isRoleKey } from "../config/requirements";
import { interactionUser } from "./helpers";

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
