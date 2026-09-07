import { describe, expect, it } from "vitest";
import { requireRole } from "./authorize";
import type { MembershipRole } from "@/lib/db/schema/membership";

const roles: MembershipRole[] = ["admin", "sales_manager", "sales_rep"];

describe("requireRole", () => {
  it.each(roles)("allows %s when it's in the allowed list", (role) => {
    expect(() => requireRole(role, [role])).not.toThrow();
  });

  it.each(roles)("denies %s when it's not in the allowed list", (role) => {
    const allowed = roles.filter((r) => r !== role);
    expect(() => requireRole(role, allowed)).toThrow(/Requires one of/);
  });

  it("allows admin for a manager-or-admin check", () => {
    expect(() => requireRole("admin", ["admin", "sales_manager"])).not.toThrow();
  });

  it("denies sales_rep for a manager-or-admin check", () => {
    expect(() => requireRole("sales_rep", ["admin", "sales_manager"])).toThrow();
  });
});
