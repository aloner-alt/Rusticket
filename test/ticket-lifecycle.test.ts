import { describe, expect, it } from "vitest";
import { acceptedTicketCloseDue } from "../src/handlers/staffActions";
import type { ApplicationRecord } from "../src/types";

function application(status: ApplicationRecord["status"], decidedAt?: string): ApplicationRecord {
  return {
    applicantId: "1", applicantUsername: "test", ticketChannelId: "2", cardMessageId: "3",
    age: 18, dailyOnline: 8, role: "combat", steamUrl: "https://steamcommunity.com/profiles/76561198000000000",
    steamId64: "76561198000000000", rustHours: 4000, requiredHours: 3500, status,
    createdAt: "2026-09-20T00:00:00.000Z", ...(decidedAt ? { decidedAt } : {})
  };
}

describe("accepted ticket lifecycle", () => {
  const acceptedAt = "2026-09-20T10:00:00.000Z";

  it("keeps an accepted ticket before one hour", () => {
    expect(acceptedTicketCloseDue(application("ACCEPTED", acceptedAt), Date.parse("2026-09-20T10:59:59.999Z"))).toBe(false);
  });

  it("closes an accepted ticket after one hour", () => {
    expect(acceptedTicketCloseDue(application("ACCEPTED", acceptedAt), Date.parse("2026-09-20T11:00:00.000Z"))).toBe(true);
  });

  it("never closes a pending ticket through the accepted-ticket job", () => {
    expect(acceptedTicketCloseDue(application("PENDING"), Date.parse("2026-09-21T11:00:00.000Z"))).toBe(false);
  });
});
