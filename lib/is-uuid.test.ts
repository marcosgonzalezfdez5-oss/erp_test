import { describe, expect, it } from "vitest";
import { isUuid } from "./is-uuid";

describe("isUuid", () => {
  it("accepts a well-formed UUID", () => {
    expect(isUuid(crypto.randomUUID())).toBe(true);
  });

  it("rejects malformed values", () => {
    for (const value of ["", "not-a-uuid", "99999", "123", "  ", "g".repeat(36)]) {
      expect(isUuid(value)).toBe(false);
    }
  });
});
