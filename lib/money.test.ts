import { describe, expect, it } from "vitest";
import {
  applyRate,
  computeDocumentTotals,
  divRound,
  fromCents,
  sumAmounts,
  toBips,
  toCents,
  toMilliUnits,
  type DocumentLineInput,
} from "./money";

describe("money — scalar parsing", () => {
  it("parses amounts to integer cents, truncating beyond 2dp like the money column", () => {
    expect(toCents("19.99")).toBe(1999n);
    expect(toCents("100")).toBe(10000n);
    expect(toCents("0.1")).toBe(10n);
    expect(toCents("-19.99")).toBe(-1999n);
    expect(toCents("1.999")).toBe(199n); // truncated, not rounded
  });

  it("round-trips cents to a 2dp string", () => {
    expect(fromCents(1999n)).toBe("19.99");
    expect(fromCents(5n)).toBe("0.05");
    expect(fromCents(-1999n)).toBe("-19.99");
    expect(fromCents(0n)).toBe("0.00");
  });

  it("parses quantities to thousandths and percents to bips", () => {
    expect(toMilliUnits("2.5")).toBe(2500n);
    expect(toMilliUnits("2.500")).toBe(2500n);
    expect(toBips("21")).toBe(2100n);
    expect(toBips("10.5")).toBe(1050n);
  });

  it("rejects non-numeric input", () => {
    expect(() => toCents("abc")).toThrow(RangeError);
    expect(() => toMilliUnits("")).toThrow(RangeError);
  });

  it("sums decimal strings without float drift", () => {
    // naive float: 0.1 + 0.2 = 0.30000000000000004
    expect(sumAmounts(["0.10", "0.20"])).toBe("0.30");
    expect(sumAmounts(["19.99", "0.01", "-5.00"])).toBe("15.00");
    expect(sumAmounts([])).toBe("0.00");
  });
});

describe("money — rounding", () => {
  it("divRound rounds half away from zero", () => {
    expect(divRound(5n, 2n)).toBe(3n); // 2.5 → 3
    expect(divRound(-5n, 2n)).toBe(-3n); // -2.5 → -3
    expect(divRound(4n, 2n)).toBe(2n);
    expect(divRound(1n, 3n)).toBe(0n); // 0.333 → 0
    expect(divRound(2n, 3n)).toBe(1n); // 0.666 → 1
  });

  it("applyRate computes VAT on a base", () => {
    expect(applyRate(10000n, toBips("21"))).toBe(2100n); // 100.00 @ 21% = 21.00
    expect(applyRate(3333n, toBips("21"))).toBe(700n); // 33.33 @ 21% = 6.9993 → 7.00
  });
});

describe("money — computeDocumentTotals", () => {
  it("applies a line discount and preserves the list price as the net", () => {
    const [line] = computeDocumentTotals([
      {
        listUnitPrice: "100.00",
        quantity: "10",
        discountPercent: "15",
        taxRatePercent: "21",
        taxTreatment: "standard",
      },
    ]).lines;
    expect(line.netUnitPrice).toBe("85.00");
    expect(line.lineBase).toBe("850.00");
  });

  it("supports a fixed per-unit discount amount when no percent is given", () => {
    const totals = computeDocumentTotals([
      { listUnitPrice: "50.00", quantity: "2", discountAmount: "5.00", taxRatePercent: "21", taxTreatment: "standard" },
    ]);
    expect(totals.lines[0].netUnitPrice).toBe("45.00");
    expect(totals.subtotal).toBe("90.00");
  });

  it("handles decimal quantities (selling by weight)", () => {
    const totals = computeDocumentTotals([
      { listUnitPrice: "12.40", quantity: "2.500", taxRatePercent: "10", taxTreatment: "standard" },
    ]);
    expect(totals.lines[0].lineBase).toBe("31.00");
    expect(totals.taxGroups[0].tax).toBe("3.10");
    expect(totals.total).toBe("34.10");
  });

  it("rounds tax once per rate group on the summed base, not per line", () => {
    // three lines of 33.33 @ 21%. Per-line: round(33.33*.21)=7.00 ×3 = 21.00.
    // Rate-group: round(99.99*.21) = round(20.9979) = 21.00 here, but the base
    // 33.33+33.33+33.34 = 100.00 → round(21.00) = 21.00. Use a splitting case
    // where the two diverge:
    const lines: DocumentLineInput[] = [
      { listUnitPrice: "10.10", quantity: "1", taxRatePercent: "21", taxTreatment: "standard" },
      { listUnitPrice: "10.10", quantity: "1", taxRatePercent: "21", taxTreatment: "standard" },
      { listUnitPrice: "10.10", quantity: "1", taxRatePercent: "21", taxTreatment: "standard" },
    ];
    const totals = computeDocumentTotals(lines);
    // per-line would be round(10.10*0.21)=round(2.121)=2.12 ×3 = 6.36
    // rate-group is round(30.30*0.21)=round(6.363)=6.36 — equal here; assert the group path
    expect(totals.taxGroups).toHaveLength(1);
    expect(totals.taxGroups[0].base).toBe("30.30");
    expect(totals.taxGroups[0].tax).toBe("6.36");
  });

  it("diverges from per-line rounding on an asymmetric split", () => {
    // 0.125 @ 21%: base 12.5c → per-line round = round(2.625c) = 3c.
    // Two such lines per-line = 6c; rate-group = round(25c * .21) = round(5.25c) = 5c.
    const lines: DocumentLineInput[] = [
      { listUnitPrice: "0.125", quantity: "1", taxRatePercent: "21", taxTreatment: "standard" },
      { listUnitPrice: "0.125", quantity: "1", taxRatePercent: "21", taxTreatment: "standard" },
    ];
    const totals = computeDocumentTotals(lines);
    expect(totals.taxGroups[0].base).toBe("0.24"); // 0.12 + 0.12 (each line base truncated)
    expect(totals.taxGroups[0].tax).toBe("0.05"); // round(0.24 * 0.21) = round(0.0504) = 0.05
  });

  it("produces a per-rate breakdown across multiple VAT rates", () => {
    const totals = computeDocumentTotals([
      { listUnitPrice: "1000.00", quantity: "1", taxRatePercent: "21", taxTreatment: "standard" },
      { listUnitPrice: "200.00", quantity: "1", taxRatePercent: "10", taxTreatment: "standard" },
    ]);
    expect(totals.taxGroups.map((g) => [g.taxRatePercent, g.base, g.tax])).toEqual([
      ["21", "1000.00", "210.00"],
      ["10", "200.00", "20.00"],
    ]);
    expect(totals.subtotal).toBe("1200.00");
    expect(totals.taxTotal).toBe("230.00");
    expect(totals.total).toBe("1430.00");
  });

  it("charges no VAT on an intra-community supply and attaches the legal note", () => {
    const totals = computeDocumentTotals([
      { listUnitPrice: "500.00", quantity: "1", taxRatePercent: "0", taxTreatment: "intra_community" },
    ]);
    expect(totals.taxTotal).toBe("0.00");
    expect(totals.taxGroups[0].legalNote).toContain("art. 25 LIVA");
    expect(totals.total).toBe("500.00");
  });

  it("subtracts IRPF withholding from lines that are subject to it", () => {
    const totals = computeDocumentTotals(
      [
        {
          listUnitPrice: "1000.00",
          quantity: "1",
          taxRatePercent: "21",
          taxTreatment: "standard",
          subjectToWithholding: true,
        },
      ],
      { withholdingRatePercent: "15" },
    );
    expect(totals.subtotal).toBe("1000.00");
    expect(totals.taxTotal).toBe("210.00");
    expect(totals.withholding).toBe("150.00");
    expect(totals.total).toBe("1060.00"); // 1000 + 210 − 150
  });

  it("returns zeroes for an empty document", () => {
    const totals = computeDocumentTotals([]);
    expect(totals).toMatchObject({ subtotal: "0.00", taxTotal: "0.00", withholding: "0.00", total: "0.00" });
    expect(totals.taxGroups).toHaveLength(0);
  });

  it("does not overflow on large line totals", () => {
    // €9,999,999.99 × 999.999 units — well past Number.MAX_SAFE_INTEGER in cents·milli
    const totals = computeDocumentTotals([
      { listUnitPrice: "9999999.99", quantity: "999.999", taxRatePercent: "21", taxTreatment: "standard" },
    ]);
    expect(totals.subtotal).toBe("9999989990.00");
  });
});
