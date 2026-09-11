import { describe, expect, it } from "vitest";
import { parseSteamProfileUrl } from "../src/steam/steamUrl";
import { normalizeChannelName, parseStrictInteger } from "../src/utils/validation";

describe("parseSteamProfileUrl", () => {
  it("accepts a direct SteamID64 profile", () => {
    expect(parseSteamProfileUrl("https://steamcommunity.com/profiles/76561198000000000"))
      .toEqual({ type: "steamid", value: "76561198000000000", profileUrl: "https://steamcommunity.com/profiles/76561198000000000" });
  });

  it("accepts a vanity URL", () => {
    expect(parseSteamProfileUrl("https://steamcommunity.com/id/example_user/"))
      .toEqual({ type: "vanity", value: "example_user", profileUrl: "https://steamcommunity.com/id/example_user" });
  });

  it.each([
    "http://steamcommunity.com/id/example",
    "https://evil.example/id/example",
    "https://steamcommunity.com.evil.example/id/example",
    "https://steamcommunity.com/groups/example",
    "not a url"
  ])("rejects untrusted input: %s", (value) => {
    expect(parseSteamProfileUrl(value)).toBeNull();
  });
});

describe("validation helpers", () => {
  it("parses integers only", () => {
    expect(parseStrictInteger("18")).toBe(18);
    expect(parseStrictInteger("8+")).toBe(8);
    expect(parseStrictInteger("8 +")).toBe(8);
    expect(parseStrictInteger("4.5")).toBeNull();
    expect(parseStrictInteger("18 years")).toBeNull();
  });

  it("creates a safe channel name", () => {
    expect(normalizeChannelName("Pa Blo!!!", "4821")).toBe("application-pa-blo-4821");
    expect(normalizeChannelName("Пабло", "4821")).toBe("application-user-4821");
  });
});
