import { serverBindingModal } from "../discord/components";
import { InteractionResponseType, ephemeral, jsonResponse } from "../discord/interactions";
import { isPrivateModerator } from "../discord/permissions";
import { discordRest, sendChannelMessage } from "../discord/rest";
import { fetchPlayers, fetchServer, serverEmbed } from "../rust/monitoring";
import { getRustServerConfig, saveRustServerConfig } from "../storage/applications";
import type { DiscordInteraction, Env, RustServerConfig } from "../types";
import { modalValue } from "./helpers";

async function config(env: Env): Promise<RustServerConfig> {
  return (await getRustServerConfig(env)) ?? { label: "Blood Rust — Black", connect: env.RUST_SERVER_CONNECT, monitoringId: env.MONITORING_SERVER_ID };
}

export function openServerBinding(interaction: DiscordInteraction, env: Env): Response {
  if (!isPrivateModerator(interaction, env)) return ephemeral("❌ Недостаточно прав.");
  return jsonResponse({ type: InteractionResponseType.Modal, data: serverBindingModal(env.RUST_SERVER_CONNECT, env.MONITORING_SERVER_ID) });
}

export async function bindServer(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (!isPrivateModerator(interaction, env)) return ephemeral("❌ Недостаточно прав.");
  const label = modalValue(interaction, "label")?.trim(); const connect = modalValue(interaction, "connect")?.trim(); const monitoringId = modalValue(interaction, "monitoring_id")?.trim();
  if (!label || !connect || !/^([a-z0-9.-]+):\d{2,5}$/i.test(connect) || !monitoringId || !/^\d+$/.test(monitoringId)) return ephemeral("❌ Проверьте название, connect IP:PORT и ID GAMEMONITORING.");
  const current = await getRustServerConfig(env); const next: RustServerConfig = { label, connect, monitoringId, ...(current?.publicMessageId ? { publicMessageId: current.publicMessageId } : {}) };
  const server = await fetchServer(next); await saveRustServerConfig(env, next);
  return ephemeral(`✅ Привязан **${server.name}** — ${server.numplayers}/${server.maxplayers}. Нажмите «Обновить Vipe Info».`);
}

export async function publishServerStats(interaction: DiscordInteraction, env: Env): Promise<Response> {
  if (!isPrivateModerator(interaction, env)) return ephemeral("❌ Недостаточно прав.");
  const current = await config(env); const [server, players] = await Promise.all([fetchServer(current), fetchPlayers(current)]); const body = { embeds: [serverEmbed(current, server, players)] };
  let updated = false;
  if (current.publicMessageId) updated = await discordRest(env, `/channels/${env.WIPE_CHANNEL_ID}/messages/${current.publicMessageId}`, { method: "PATCH", body: JSON.stringify(body) }).then(() => true).catch(() => false);
  if (!updated) { const message = await sendChannelMessage(env, env.WIPE_CHANNEL_ID, body); current.publicMessageId = message.id; await saveRustServerConfig(env, current); }
  return ephemeral(`✅ Статистика опубликована в <#${env.WIPE_CHANNEL_ID}>.`);
}

export async function refreshPublishedServerStats(env: Env): Promise<void> {
  const current = await getRustServerConfig(env); if (!current?.publicMessageId) return;
  const [server, players] = await Promise.all([fetchServer(current), fetchPlayers(current)]);
  await discordRest(env, `/channels/${env.WIPE_CHANNEL_ID}/messages/${current.publicMessageId}`, { method: "PATCH", body: JSON.stringify({ embeds: [serverEmbed(current, server, players)] }) });
}
