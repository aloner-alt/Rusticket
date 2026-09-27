import { describe, expect, it } from "vitest";
import { adminPanel, applicationEmbed, applicationModal, recruitmentPanel, staffApplicationModal, staffRecruitmentPanel, steamAccountsModal } from "../src/discord/components";
import { openTicketAdmin, saveAdditionalQuestion } from "../src/handlers/ticketAdmin";
import type { ApplicationRecord, DiscordInteraction, Env } from "../src/types";

type Modal = { components: Array<{ components: Array<{ custom_id: string; required: boolean }> }> };

describe("two-step application form", () => {
  it("keeps personal fields on the first step", () => {
    const modal = applicationModal("electric") as Modal;
    expect(modal.components.flatMap((row) => row.components.map((field) => field.custom_id))).toEqual([
      "age", "daily_online", "real_name", "comment"
    ]);
  });

  it("uses five separate Steam fields on the second step", () => {
    const modal = steamAccountsModal("draft-id") as Modal;
    const fields = modal.components.flatMap((row) => row.components);
    expect(fields.map((field) => field.custom_id)).toEqual(["steam_1", "steam_2", "steam_3", "steam_4", "steam_5"]);
    expect(fields.map((field) => field.required)).toEqual([true, false, false, false, false]);
    expect((fields[0] as { placeholder?: string }).placeholder).toContain("76561199403575804");
  });

  it("adds only one configured question in the remaining modal slot", () => {
    const modal = applicationModal("electric", "Когда обычно играете?") as Modal;
    const fields = modal.components.flatMap(row => row.components);
    expect(fields).toHaveLength(5);
    expect(fields.at(-1)).toMatchObject({ custom_id: "additional_answer", required: true });
  });
});

describe("ticket admin panel", () => {
  it("shows the existing close time and stores a custom question", async () => {
    const entries = new Map<string, string>();
    const env = {
      PRIVATE_GUILD_ID: "private", PRIVATE_MODERATOR_ROLE_ID: "moderator",
      APPLICATIONS: {
        get: (key: string) => Promise.resolve(entries.has(key) ? JSON.parse(entries.get(key) ?? "null") as unknown : null),
        put: (key: string, value: string) => { entries.set(key, value); return Promise.resolve(); }
      }
    } as unknown as Env;
    const interaction = { guild_id: "private", member: { roles: ["moderator"], user: { id: "1", username: "staff" } } } as DiscordInteraction;
    const initial = await (await openTicketAdmin(interaction, env)).text();
    expect(initial).toContain("1 час");
    const modal = { ...interaction, data: { custom_id: "ticket:criteria-modal:electric", components: [{ type: 1, components: [{ type: 4, custom_id: "question", value: "Когда обычно играете?" }] }] } };
    await saveAdditionalQuestion(modal, env);
    const panel = await (await openTicketAdmin(interaction, env)).text();
    expect(panel).toContain("Когда обычно играете?");
    const app = { role: "electric", status: "PENDING", applicantId: "1", steamId64: "76561198000000000", steamUrl: "https://steamcommunity.com/profiles/76561198000000000", rustHours: 2000, requiredHours: 2000, dailyOnline: 6, age: 18, createdAt: new Date().toISOString(), additionalQuestion: "Когда обычно играете?", additionalAnswer: "По вечерам" } as ApplicationRecord;
    expect(applicationEmbed(app).fields?.some(field => field.name === "Когда обычно играете?" && field.value === "По вечерам")).toBe(true);
  });
});

describe("Discord Staff recruitment", () => {
  it("uses ten shortened Staff questions without Steam profile or Rust hours", () => {
    const ids = ([1, 2, 3] as const).flatMap(step => {
      const modal = staffApplicationModal(step) as Modal;
      return modal.components.flatMap(row => row.components.map(field => field.custom_id));
    });
    expect(ids).toEqual([
      "realName", "age", "timezone", "dailyAvailability",
      "contactHours", "meetings", "adminExperience", "conflictAndRules",
      "situations", "motivation"
    ]);
    expect(ids).not.toContain("steamProfile");
    expect(ids).not.toContain("rustHours");
  });

  it("keeps Staff recruitment separate from clan recruitment", () => {
    const open = staffRecruitmentPanel(true) as { embeds: Array<{ title?: string; fields?: Array<{ name: string }> }>; components: Array<{ components: Array<{ custom_id?: string; disabled?: boolean }> }> };
    expect(open.embeds[0]?.title).toContain("Discord Staff");
    expect(open.embeds[0]?.fields?.some(field => field.name === "Критерии Staff")).toBe(true);
    expect(open.components[0]?.components[0]).toMatchObject({ custom_id: "staff-application:open", disabled: false });
  });
});

describe("recruitment switch", () => {
  it("shows role criteria and the Steam example on the existing application panel", () => {
    const panel = recruitmentPanel() as { embeds: Array<{ description?: string; fields?: Array<{ name: string; value: string }> }> };
    const embed = panel.embeds[0];
    expect(embed?.description).toContain("возраст 15+");
    expect(embed?.description).toContain("от 6 часов");
    expect(embed?.fields?.find(field => field.name.includes("Builder"))?.name).toContain("2000+");
    expect(embed?.fields?.find(field => field.name.includes("Combat"))?.value).toContain("FC 40+");
    expect(embed?.fields?.at(-1)?.value).toContain("https://steamcommunity.com/profiles/76561199403575804/");
  });

  it("disables applications and visibly marks a closed recruitment", () => {
    const panel = recruitmentPanel(false) as { embeds: { title: string }[]; components: Array<{ components: Array<{ disabled?: boolean; label: string }> }> };
    expect(panel.embeds[0]?.title).toContain("закрыт");
    expect(panel.components[0]?.components[0]).toMatchObject({ disabled: true, label: "Набор закрыт" });
  });

  it("exposes recruitment management in the private admin panel", () => {
    const panel = adminPanel() as { components: Array<{ components: Array<{ custom_id?: string }> }> };
    expect(panel.components.flatMap(row => row.components.map(button => button.custom_id))).toContain("admin:recruitment-toggle");
    expect(panel.components.flatMap(row => row.components.map(button => button.custom_id))).toContain("admin:rustplus-stats");
  });
});
