import { describe, it, expect, vi, beforeEach } from "vitest";
import { kickFromWarning, openWipeAttendance } from "../src/handlers/warnings";
import type { Env, DiscordInteraction } from "../src/types";
vi.mock("../src/storage/applications", () => ({ getWarningRecord: vi.fn() }));
vi.mock("../src/discord/rest", () => ({ discordRest: vi.fn() }));
vi.mock("../src/handlers/wipeRoster", () => ({ currentWipeRoster: vi.fn().mockResolvedValue([]) }));
import { getWarningRecord } from "../src/storage/applications";
import { discordRest } from "../src/discord/rest";
const env = { PRIVATE_GUILD_ID: "guild" } as Env;
const interaction = { id: "i", application_id: "a", type: 3, token: "test", guild_id: "guild", channel_id: "channel", member: { permissions: "8", roles: [] }, data: { custom_id: "warning:kick-confirm:123456789012345678" } } as DiscordInteraction;
beforeEach(() => vi.clearAllMocks());
describe("warn 2 kick", () => {
  it("rejects missing active warn without kicking", async () => {
    vi.mocked(getWarningRecord).mockResolvedValue(null);
    await kickFromWarning(interaction, env);
    expect(discordRest).not.toHaveBeenCalled();
  });
  it("requires moderation permission", async () => {
    await kickFromWarning({ ...interaction, member: { ...interaction.member, permissions: "0", roles: [] } }, env);
    expect(discordRest).not.toHaveBeenCalled();
  });
  it("kicks only the target in the private guild with an active warn in this channel", async () => {
    vi.mocked(getWarningRecord).mockResolvedValue({ userId: "123456789012345678", channelId: "channel", warnings: [{ level: 2, reason: "test", moderatorId: "m", issuedAt: Date.now(), expiresAt: Date.now() + 60000, channelId: "channel" }] });
    await kickFromWarning(interaction, env);
    expect(discordRest).toHaveBeenCalledWith(env, "/guilds/guild/members/123456789012345678", expect.objectContaining({ method: "DELETE" }));
  });
});
it("renders unique navigation IDs even on the first/only attendance page", async () => {
  const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const testEnv = { ...env, APPLICATIONS: { get: vi.fn().mockResolvedValue({ id, project: "Test", wipeAt: Date.now() + 100000 }), list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }) } } as unknown as Env;
  const response = await openWipeAttendance({ ...interaction, data: { custom_id: `wipe:roster:${id}:0` } }, testEnv);
  const body = await response.json<{ data: { components: { components: { custom_id: string }[] }[] } }>();
  const ids = body.data.components.flatMap(row => row.components.map(button => button.custom_id));
  expect(new Set(ids).size).toBe(ids.length);
});
