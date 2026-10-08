import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureStaffRecruitmentPanel } from "../src/handlers/recruitmentControl";
import type { Env } from "../src/types";

function setup() {
  const values = new Map<string, string>([
    ["recruitment:staff-reopened:2026-09-26-v1", "done"],
    ["recruitment:state", JSON.stringify({ open: true, staffOpen: true, staffPanelMessageId: "old" })]
  ]);
  const env = {
    APPLICATIONS: {
      get: (key: string, type?: string) => {
        const value = values.get(key) ?? null;
        return Promise.resolve(type === "json" && value ? JSON.parse(value) as unknown : value);
      },
      put: (key: string, value: string) => { values.set(key, value); return Promise.resolve(); }
    },
    TICKETS_CHANNEL_ID: "tickets",
    DISCORD_APPLICATION_ID: "bot",
    DISCORD_BOT_TOKEN: "test"
  } as unknown as Env;
  return { env, values };
}

function panel(id: string, author = "bot") {
  return { id, author: { id: author }, components: [{ components: [{ custom_id: "staff-application:open" }] }] };
}

afterEach(() => vi.unstubAllGlobals());

describe("Staff recruitment panel synchronization", () => {
  it("does not repost when Discord temporarily rejects an update", async () => {
    const { env, values } = setup();
    values.set("recruitment:staff-panel-dedupe:2026-10-08-v1", "done");
    const methods: string[] = [];
    const fetchMock = vi.fn((_input: string, init: RequestInit) => {
      methods.push(init.method ?? "GET");
      return Promise.resolve(new Response("unavailable", { status: 503 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(ensureStaffRecruitmentPanel(env)).rejects.toThrow("Discord REST 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(methods).toEqual(["PATCH"]);
  });

  it("keeps the oldest existing panel and removes only exact bot duplicates", async () => {
    const { env, values } = setup();
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn((input: string, init: RequestInit) => {
      const url = input;
      const method = init.method ?? "GET";
      calls.push({ url, method });
      if (method === "GET") return Promise.resolve(Response.json([
        panel("new"), panel("other-user", "other"), panel("original")
      ]));
      return Promise.resolve(new Response(null, { status: 204 }));
    }));

    await ensureStaffRecruitmentPanel(env);
    expect(calls.filter(call => call.method === "POST")).toHaveLength(0);
    expect(calls.filter(call => call.method === "PATCH").map(call => call.url)).toEqual([
      "https://discord.com/api/v10/channels/tickets/messages/original"
    ]);
    expect(calls.filter(call => call.method === "DELETE").map(call => call.url)).toEqual([
      "https://discord.com/api/v10/channels/tickets/messages/new"
    ]);
    expect(values.get("recruitment:staff-panel-message-id")).toBe("original");
    expect(values.get("recruitment:staff-panel-dedupe:2026-10-08-v1")).toBe("done");
  });

  it("does not create a new panel if the recovery scan fails", async () => {
    const { env } = setup();
    const methods: string[] = [];
    const fetchMock = vi.fn((_input: string, init: RequestInit) => {
      methods.push(init.method ?? "GET");
      return Promise.resolve(new Response("rate limited", { status: 429 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(ensureStaffRecruitmentPanel(env)).rejects.toThrow("Discord REST 429");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(methods).toEqual(["GET"]);
  });
});
