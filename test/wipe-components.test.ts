import { describe, expect, it } from "vitest";
import {
  ageRejectionActions, wipeAnnouncementButtons, wipeAttendanceDecisionButtons, wipeModal
} from "../src/discord/components";

type Component = { custom_id?: string; components?: Component[] };
type Modal = { components: Component[] };

const ids = (rows: Component[]): string[] => rows.flatMap((row) => row.components?.map((item) => item.custom_id ?? "") ?? []);

describe("age exception action", () => {
  it("offers direct acceptance from the log", () => {
    expect(ids(ageRejectionActions("review-id") as Component[])).toEqual(["review:age-accept:review-id"]);
  });
});

describe("wipe controls", () => {
  it("collects a map URL in the wipe modal", () => {
    const modal = wipeModal() as Modal;
    expect(ids(modal.components)).toContain("map_url");
  });

  it("contains all RSVP and caller controls", () => {
    expect(ids(wipeAnnouncementButtons("wipe-id") as Component[])).toEqual([
      "wipe:rsvp:yes:wipe-id",
      "wipe:rsvp:late:wipe-id",
      "wipe:rsvp:no:wipe-id",
      "wipe:square:wipe-id"
    ]);
  });

  it("offers present and absent decisions", () => {
    expect(ids(wipeAttendanceDecisionButtons("wipe-id", "user-id") as Component[])).toEqual([
      "wipe:present:wipe-id:user-id",
      "wipe:absent:wipe-id:user-id"
    ]);
  });
});
