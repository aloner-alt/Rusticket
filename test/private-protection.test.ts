import { describe, expect, it } from "vitest";
import { GUEST_BLOCK, protectedOverwrites } from "../src/handlers/privateProtection";

const roles = [{ id: "guild", permissions: (2048n | 1048576n).toString() }, { id: "rust", permissions: "0" }];
describe("guest protection", () => {
  it("blocks roleless guests while preserving Rust access and unrelated member overwrites", () => {
    const member = { id: "person", type: 1, allow: "1024", deny: "0" };
    const rows = protectedOverwrites({ id: "c", type: 0, permission_overwrites: [member] }, "guild", roles, "rust", "mod", "bot");
    expect(BigInt(rows.find(row => row.id === "guild")?.deny ?? "0") & GUEST_BLOCK).toBe(GUEST_BLOCK);
    expect(BigInt(rows.find(row => row.id === "rust")?.allow ?? "0") & 2048n).toBe(2048n);
    expect(rows.find(row => row.id === "person")).toEqual(member);
    expect(rows.every(row => (BigInt(row.allow) & 1024n) === 0n || row.id === "person")).toBe(true);
  });
  it("does not give Rust members write access to previously read-only channels", () => {
    const rows = protectedOverwrites({ id: "c", type: 0, permission_overwrites: [{ id: "guild", type: 0, deny: "2048", allow: "0" }] }, "guild", roles, "rust", "mod", "bot");
    expect(BigInt(rows.find(row => row.id === "rust")?.allow ?? "0") & 2048n).toBe(0n);
  });
  it("preserves explicit Rust denial", () => {
    const rows = protectedOverwrites({ id: "c", type: 0, permission_overwrites: [{ id: "rust", type: 0, deny: "2048", allow: "0" }] }, "guild", roles, "rust", "mod", "bot");
    expect(rows.find(row => row.id === "rust")?.deny).toBe("2048");
    expect(rows.find(row => row.id === "rust")?.allow).not.toBe("2048");
  });
});
