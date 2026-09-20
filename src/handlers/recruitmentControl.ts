import { recruitmentPanel } from "../discord/components";
import { ephemeral } from "../discord/interactions";
import { isPrivateModerator } from "../discord/permissions";
import { discordRest } from "../discord/rest";
import { getRecruitmentState, saveRecruitmentState } from "../storage/applications";
import type { DiscordInteraction, Env } from "../types";
import { logEvent } from "../utils/logger";
import { interactionUser } from "./helpers";

export const RECRUITMENT_CLOSED_MESSAGE = "🔒 Набор в клан сейчас закрыт. Дождитесь объявления об открытии набора.";

export async function toggleRecruitment(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (interaction.guild_id !== env.PRIVATE_GUILD_ID || !isPrivateModerator(interaction, env)) return ephemeral("❌ Управлять набором может только Staff привата.");
  const staff = interactionUser(interaction);
  const current = await getRecruitmentState(env);
  const next = { ...current, open: !current.open, updatedAt: Date.now(), ...(staff ? { updatedBy: staff.id } : {}) };
  await saveRecruitmentState(env, next);
  if (next.panelMessageId) {
    await discordRest(env, `/channels/${env.TICKETS_CHANNEL_ID}/messages/${next.panelMessageId}`, {
      method: "PATCH", body: JSON.stringify(recruitmentPanel(next.open))
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
