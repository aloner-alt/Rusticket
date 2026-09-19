import { describe, expect, it } from "vitest";
import { applicationModal, steamAccountsModal } from "../src/discord/components";

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
  });
});
