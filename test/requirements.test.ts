import { describe, expect, it } from "vitest";
import { ROLE_REQUIREMENTS, isRoleKey } from "../src/config/requirements";

describe("role requirements", () => {
  it("uses role-specific Rust thresholds", () => {
    expect(ROLE_REQUIREMENTS.combat.minimumRustHours).toBe(3500);
    expect(ROLE_REQUIREMENTS.farm.minimumRustHours).toBe(2000);
    expect(ROLE_REQUIREMENTS.builder.minimumRustHours).toBe(3000);
    expect(ROLE_REQUIREMENTS.industrial.minimumRustHours).toBe(2000);
    expect(ROLE_REQUIREMENTS.electric.minimumRustHours).toBe(2000);
    expect(ROLE_REQUIREMENTS.pilot.minimumRustHours).toBe(1500);
  });

  it("validates role keys", () => {
    expect(isRoleKey("pilot")).toBe(true);
    expect(isRoleKey("industrial")).toBe(true);
  });
});
