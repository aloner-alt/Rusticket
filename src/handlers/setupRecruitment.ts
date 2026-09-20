import { recruitmentPanel } from "../discord/components";
import { InteractionResponseType, ephemeral, jsonResponse } from "../discord/interactions";
import { discordRest } from "../discord/rest";
import { isStaff } from "../discord/permissions";
import type { DiscordInteraction, Env } from "../types";
import { getRecruitmentState, saveRecruitmentState } from "../storage/applications";

export async function setupRecruitment(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (!isStaff(interaction, env)) return ephemeral("❌ У вас нет прав для использования этой команды.");
  if (!env.TICKETS_CHANNEL_ID) return ephemeral("⚠️ Канал панели не настроен.");

  const state = await getRecruitmentState(env);
  const message = await discordRest<{ id: string }>(env, `/channels/${env.TICKETS_CHANNEL_ID}/messages`, {
    method: "POST",
    body: JSON.stringify(recruitmentPanel(state.open))
  });
  await saveRecruitmentState(env, { ...state, panelMessageId: message.id });
  return jsonResponse({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: { content: `✅ Панель заявок опубликована в <#${env.TICKETS_CHANNEL_ID}>.`, flags: 64 }
  });
}
