import { describe, expect, it, vi, afterEach } from "vitest";
import { absenceReason, currentWipeRoster } from "../src/handlers/wipeRoster";
import type { Env, WipeAttendanceRecord } from "../src/types";

afterEach(() => vi.unstubAllGlobals());
describe("wipe eligibility", () => {
  it("uses live Rust members, including unlinked members, excludes bots and other roles", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { user: { id: "current" }, roles: ["rust"] },
      { user: { id: "guest" }, roles: [] },
      { user: { id: "bot", bot: true }, roles: ["rust"] }
    ]))));
    const env = { PRIVATE_GUILD_ID: "guild", PRIVATE_RUST_ROLE_ID: "rust", DISCORD_BOT_TOKEN: "test" } as Env;
    expect((await currentWipeRoster(env)).map(member => member.user.id)).toEqual(["current"]);
  });
  it("does not interpret Discord errors as an empty roster", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("denied", { status: 403 })));
    await expect(currentWipeRoster({} as Env)).rejects.toThrow();
  });
  it("punishes silence and broken promises, exempts declared absence and existing penalty", () => {
    const base: WipeAttendanceRecord = { userId: "u", wipeId: "w", updatedAt: 0 };
    expect(absenceReason(null, "Test")).toContain("Не ответил");
    expect(absenceReason({ ...base, rsvp: "yes" }, "Test")).toContain("Подтвердил");
    expect(absenceReason({ ...base, rsvp: "late" }, "Test")).toContain("Подтвердил");
    expect(absenceReason({ ...base, rsvp: "no", reason: "Работа" }, "Test")).toBeNull();
    expect(absenceReason({ ...base, rsvp: "yes", warningIssuedAt: 123 }, "Test")).toBeNull();
  });
});
