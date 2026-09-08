import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("formats a whole-dollar amount", () => {
    expect(formatMoney("1234.00")).toBe("$1,234.00");
  });

  it("pads single-digit cents", () => {
    expect(formatMoney("19.5")).toBe("$19.50");
  });

  it("groups thousands", () => {
    expect(formatMoney("1000000.99")).toBe("$1,000,000.99");
  });

  it("formats negative amounts with a minus sign", () => {
    expect(formatMoney("-42.10")).toBe("−$42.10");
  });

  it("formats zero", () => {
    expect(formatMoney("0.00")).toBe("$0.00");
  });
});
