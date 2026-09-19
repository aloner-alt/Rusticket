import { describe, expect, it } from "vitest";
import { NEW_MEMBER_ROLE_DURATION_MS, newMemberRoleExpiresAt } from "../src/handlers/privateOnboarding";

describe("new member role", () => {
  it("expires exactly seven days after claim", () => {
    const now = Date.UTC(2026, 8, 19, 12, 0, 0);
    expect(newMemberRoleExpiresAt(now)).toBe(now + NEW_MEMBER_ROLE_DURATION_MS);
    expect(NEW_MEMBER_ROLE_DURATION_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
