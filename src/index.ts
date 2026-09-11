import { messages } from "./config/messages";
import { CustomId } from "./discord/components";
import { EPHEMERAL, InteractionResponseType, InteractionType, deferredEphemeral, deferredPublic, ephemeral, jsonResponse } from "./discord/interactions";
import { editOriginalResponse } from "./discord/rest";
import { verifyDiscordRequest } from "./discord/verification";
import { openApplication, selectRole } from "./handlers/openApplication";
import { setupRecruitment } from "./handlers/setupRecruitment";
import { submitApplication } from "./handlers/submitApplication";
import { acceptApplication, cancelClose, closeTicket, confirmClose, inviteCandidateToVoice, openRejectModal, rejectApplication } from "./handlers/staffActions";
import { banFromReview, createExceptionTicket, openExceptionModal, unbanFromReview } from "./handlers/reviewModeration";
import { claimRoles } from "./handlers/privateOnboarding";
import { checkPlayer } from "./handlers/playerCheck";
import { bindServer, openServerBinding, publishServerStats, refreshPublishedServerStats, showServerPlayers } from "./handlers/serverStats";
import { expireWarnings, issueWarning, openUserSelection, openWipeModal, ownWarningStatus, permanentBlacklist, removeWarningFromChannel, selectedMemberInfo, selectBlacklistUser, selectWarningUser, sendDueWipeReminders, setupAdminPanel, submitWipe } from "./handlers/warnings";
import type { DiscordInteraction, Env } from "./types";

async function editPlayerCheckError(interaction: DiscordInteraction, env: Env): Promise<void> {
  await editOriginalResponse(env, interaction.token, { content: "⚠️ Не удалось получить данные игрока. Попробуйте ещё раз немного позже." }).catch(() => undefined);
}

function validateEnvironment(env: Env): void {
  const required: Array<keyof Env> = [
    "DISCORD_APPLICATION_ID", "DISCORD_PUBLIC_KEY", "DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID",
    "STEAM_API_KEY", "TICKETS_CHANNEL_ID", "TICKETS_CATEGORY_ID", "LOG_CHANNEL_ID", "APPLICATIONS",
    "PRIVATE_INVITE_URL", "PUBLIC_MAIN_ROLE_ID", "PRIVATE_GUILD_ID", "PRIVATE_ADMIN_CHANNEL_ID",
    "BLACKLIST_CHANNEL_ID", "PRIVATE_RUST_ROLE_ID", "PRIVATE_COMBAT_ROLE_ID", "PRIVATE_FARM_ROLE_ID",
    "PRIVATE_BUILDER_ROLE_ID", "PRIVATE_INDUSTRIAL_ROLE_ID", "PRIVATE_ELECTRIC_ROLE_ID", "PRIVATE_PILOT_ROLE_ID"
    , "PRIVATE_MODERATOR_ROLE_ID", "PRIVATE_WARN_1_ROLE_ID", "PRIVATE_WARN_2_ROLE_ID", "PUNISHMENT_CATEGORY_ID", "WIPE_CHANNEL_ID", "RUST_SERVER_CONNECT", "MONITORING_SERVER_ID", "PLAYER_CHECK_CHANNEL_ID"
  ];
  for (const key of required) {
    if (!env[key]) throw new Error(`Missing environment binding: ${key}`);
  }
}

async function route(interaction: DiscordInteraction, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (interaction.type === InteractionType.Ping) return jsonResponse({ type: InteractionResponseType.Pong });

  if (!interaction.guild_id || (interaction.guild_id !== env.DISCORD_GUILD_ID && interaction.guild_id !== env.PRIVATE_GUILD_ID)) {
    return ephemeral("❌ Эта команда доступна только на настроенном сервере .int.");
  }

  if (interaction.type === InteractionType.ApplicationCommand && interaction.data?.name === "setup-recruitment") {
    return setupRecruitment(interaction, env);
  }
  if (interaction.type === InteractionType.ApplicationCommand && interaction.data?.name === "claim") {
    return claimRoles(interaction, env);
  }
  if (interaction.type === InteractionType.ApplicationCommand && interaction.data?.name === "setup-admin-panel") {
    return setupAdminPanel(interaction, env);
  }
  if (interaction.type === InteractionType.ApplicationCommand && interaction.data?.name === "warn-status") return ownWarningStatus(interaction, env);
  if (interaction.type === InteractionType.ApplicationCommand && interaction.data?.name === "check-player") {
    ctx.waitUntil(checkPlayer(interaction, env).catch(() => editPlayerCheckError(interaction, env)));
    return deferredPublic();
  }

  const customId = interaction.data?.custom_id;
  if (interaction.type === InteractionType.MessageComponent) {
    if (customId === CustomId.Open) return openApplication(interaction, env);
    if (customId === CustomId.Role) return selectRole(interaction);
    if (customId === CustomId.Accept) return acceptApplication(interaction, env);
    if (customId === CustomId.Reject) return openRejectModal(interaction, env);
    if (customId === CustomId.InviteVoice) return inviteCandidateToVoice(interaction, env);
    if (customId === CustomId.Close) return confirmClose(interaction, env);
    if (customId === CustomId.CloseConfirm) return closeTicket(interaction, env, ctx);
    if (customId === CustomId.CloseCancel) return cancelClose();
    if (customId?.startsWith("review:exception:")) return openExceptionModal(interaction, env);
    if (customId?.startsWith("review:ban:")) return banFromReview(interaction, env);
    if (customId?.startsWith("review:unban:")) return unbanFromReview(interaction, env);
    if (customId === "admin:warn") return openUserSelection(interaction, env, "warn");
    if (customId === "admin:member-info") return openUserSelection(interaction, env, "member-info");
    if (customId === "admin:blacklist") return openUserSelection(interaction, env, "blacklist");
    if (customId === "admin:warn-user") return selectWarningUser(interaction, env);
    if (customId === "admin:member-info-user") return selectedMemberInfo(interaction, env);
    if (customId === "admin:blacklist-user") return selectBlacklistUser(interaction, env);
    if (customId === "admin:wipe") return openWipeModal(interaction, env);
    if (customId === "admin:server-bind") return openServerBinding(interaction, env);
    if (customId === "admin:server-players") return showServerPlayers(interaction, env);
    if (customId === "admin:server-publish") return publishServerStats(interaction, env);
    if (customId?.startsWith("warning:remove:")) return removeWarningFromChannel(interaction, env);
  }

  if (interaction.type === InteractionType.ModalSubmit && customId?.startsWith(CustomId.FormPrefix)) {
    const role = customId.slice(CustomId.FormPrefix.length);
    ctx.waitUntil(submitApplication(interaction, env, role).catch(async (error: unknown) => {
      console.error("Application submission failed", error instanceof Error ? error.message : "unknown error");
      const url = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`;
      await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: messages.genericError, flags: EPHEMERAL })
      }).catch(() => undefined);
    }));
    return deferredEphemeral();
  }

  if (interaction.type === InteractionType.ModalSubmit && customId === CustomId.RejectModal) {
    return rejectApplication(interaction, env);
  }
  if (interaction.type === InteractionType.ModalSubmit && customId?.startsWith("review:exception-modal:")) {
    return createExceptionTicket(interaction, env);
  }
  if (interaction.type === InteractionType.ModalSubmit && customId?.startsWith("admin:warn-modal:")) return issueWarning(interaction, env);
  if (interaction.type === InteractionType.ModalSubmit && customId === "admin:wipe-modal") return submitWipe(interaction, env);
  if (interaction.type === InteractionType.ModalSubmit && customId === "admin:server-bind-modal") return bindServer(interaction, env);
  if (interaction.type === InteractionType.ModalSubmit && customId?.startsWith("admin:blacklist-modal:")) return permanentBlacklist(interaction, env);

  return ephemeral("⚠️ Неизвестное действие. Обновите сообщение или попробуйте снова.");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") return new Response("Rusticket is running", { status: 200 });
    const body = await request.text();
    if (!(await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY, body))) {
      return new Response("Unauthorized", { status: 401 });
    }

    try {
      validateEnvironment(env);
      const interaction = JSON.parse(body) as DiscordInteraction;
      return await route(interaction, env, ctx);
    } catch (error) {
      console.error("Interaction failed", error instanceof Error ? error.message : "unknown error");
      return jsonResponse({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { content: messages.genericError, flags: EPHEMERAL }
      });
    }
  },
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(Promise.all([expireWarnings(env), sendDueWipeReminders(env), refreshPublishedServerStats(env)]).then(() => undefined));
  }
} satisfies ExportedHandler<Env>;
