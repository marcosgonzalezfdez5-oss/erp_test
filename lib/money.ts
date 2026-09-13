/**
 * The single home for money and tax arithmetic (CLAUDE.md §9: financial
 * calculations must be deterministic plain code, never an LLM, never float).
 *
 * Money is stored as `numeric(12,2)` decimal strings ("19.99"), quantities as
 * `numeric(12,3)` strings ("2.500"), and tax/discount rates as percent strings
 * ("21", "10.5"). All arithmetic here runs in **integer BigInt** — cents for
 * money, thousandths for quantity, hundredths-of-a-percent ("bips") for rates —
 * so there is no rounding drift and no 2^53 overflow ceiling.
 *
 * The document pipeline (`computeDocumentTotals`) runs in one fixed order and is
 * exhaustively unit-tested with fixed vectors:
 *   1. netUnitPrice = listUnitPrice − discount        (percent, else fixed amount)
 *   2. lineBase     = round(netUnitPrice × quantity)
 *   3. group lines by (taxRatePercent, taxTreatment); groupTax = round(Σ base × rate)
 *   4. subtotal = Σ lineBase ; taxTotal = Σ groupTax
 *   5. withholding = round(Σ base where subjectToWithholding × irpfRate)   (Spain: IRPF)
 *   6. total = subtotal + taxTotal − withholding
 *
 * Rounding is half-away-from-zero ("redondeo comercial"), the AEAT convention,
 * applied once per group on the summed base — not per line — so the invoice
 * total matches what the customer's own accounting system computes.
 */

// ---------------------------------------------------------------------------
// scalar parsing / formatting

const CENTS_SCALE = 2;
const QTY_SCALE = 3;

function parseFixed(value: string, scale: number, label: string): bigint {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new RangeError(`${label} is not a decimal number: ${JSON.stringify(value)}`);
  }
  const negative = trimmed.startsWith("-");
  const [whole, fraction = ""] = trimmed.replace("-", "").split(".");
  // extra fractional digits are truncated, matching Postgres numeric(_, scale)
  const scaled = `${whole}${(fraction + "0".repeat(scale)).slice(0, scale)}`;
  const magnitude = BigInt(scaled);
  return negative ? -magnitude : magnitude;
}

function formatFixed(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** "19.99" → 1999n (cents). Truncates beyond 2 dp, like the money column. */
export function toCents(amount: string): bigint {
  return parseFixed(amount, CENTS_SCALE, "amount");
}

/** 1999n → "19.99". */
export function fromCents(cents: bigint): string {
  return formatFixed(cents, CENTS_SCALE);
}

/** "2.500" → 2500n (thousandths). */
export function toMilliUnits(quantity: string): bigint {
  return parseFixed(quantity, QTY_SCALE, "quantity");
}

/** 2500n → "2.500". */
export function fromMilliUnits(milli: bigint): string {
  return formatFixed(milli, QTY_SCALE);
}

/** Percent string → hundredths of a percent. "21" → 2100n, "10.5" → 1050n. */
export function toBips(percent: string): bigint {
  return parseFixed(percent, CENTS_SCALE, "percent");
}

/** Sum any number of `numeric(12,2)` decimal strings exactly. */
export function sumAmounts(amounts: string[]): string {
  return fromCents(amounts.reduce((acc, a) => acc + toCents(a), 0n));
}

// ---------------------------------------------------------------------------
// rounding

/**
 * `numerator / denominator`, rounded half away from zero. BigInt-exact, so it
 * never loses precision on large line totals.
 */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError("denominator must be positive");
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twiceRemainder = (remainder < 0n ? -remainder : remainder) * 2n;
  if (twiceRemainder >= denominator) return quotient + (numerator < 0n ? -1n : 1n);
  return quotient;
}

/** `baseCents × ratePercent`, e.g. VAT or IRPF on a taxable base. */
export function applyRate(baseCents: bigint, rateBips: bigint): bigint {
  return divRound(baseCents * rateBips, 10_000n);
}

// ---------------------------------------------------------------------------
// document pipeline

export const TAX_TREATMENTS = [
  "standard", // domestic supply, VAT charged
  "exempt", // e.g. LIVA art. 20
  "intra_community", // supply to another EU member state, LIVA art. 25
  "reverse_charge", // recipient accounts for VAT, LIVA art. 84
  "export", // supply outside the EU, LIVA art. 21
] as const;

export type TaxTreatment = (typeof TAX_TREATMENTS)[number];

/** Only a `standard` supply actually produces output VAT. */
export function isTaxable(treatment: TaxTreatment): boolean {
  return treatment === "standard";
}

export interface DocumentLineInput {
  /** Catalogue / agreed unit price before any discount. */
  listUnitPrice: string;
  /** `numeric(12,3)` decimal string. */
  quantity: string;
  /** Percent off the unit price. Takes precedence over `discountAmount`. */
  discountPercent?: string;
  /** Fixed amount off **each unit**. Used only when `discountPercent` is absent. */
  discountAmount?: string;
  taxRatePercent: string;
  taxTreatment: TaxTreatment;
  /** Whether this line's base feeds the IRPF withholding calculation. */
  subjectToWithholding?: boolean;
}

export interface ComputedLine {
  netUnitPrice: string;
  lineBase: string;
}

export interface TaxGroup {
  taxRatePercent: string;
  taxTreatment: TaxTreatment;
  base: string;
  tax: string;
  /** The legal mention that must appear on the invoice for a non-standard treatment. */
  legalNote?: string;
}

export interface DocumentTotals {
  lines: ComputedLine[];
  subtotal: string;
  taxGroups: TaxGroup[];
  taxTotal: string;
  withholding: string;
  total: string;
}

const LEGAL_NOTES: Partial<Record<TaxTreatment, string>> = {
  exempt: "Operación exenta de IVA (art. 20 LIVA).",
  intra_community: "Entrega intracomunitaria exenta (art. 25 LIVA).",
  reverse_charge: "Inversión del sujeto pasivo (art. 84 LIVA).",
  export: "Exportación exenta (art. 21 LIVA).",
};

function netUnitCents(line: DocumentLineInput): bigint {
  const listCents = toCents(line.listUnitPrice);
  let discount = 0n;
  if (line.discountPercent !== undefined && line.discountPercent !== "") {
    discount = applyRate(listCents, toBips(line.discountPercent));
  } else if (line.discountAmount !== undefined && line.discountAmount !== "") {
    discount = toCents(line.discountAmount);
  }
  const net = listCents - discount;
  return net < 0n ? 0n : net;
}

/**
 * The full six-step money/tax computation for an order or invoice. Pure — the
 * caller persists the returned strings as the document's snapshot.
 */
export function computeDocumentTotals(
  lines: DocumentLineInput[],
  opts: { withholdingRatePercent?: string } = {},
): DocumentTotals {
  const withBase = lines.map((line) => {
    const net = netUnitCents(line);
    const base = divRound(net * toMilliUnits(line.quantity), 1_000n);
    return { line, netCents: net, baseCents: base };
  });

  const computedLines: ComputedLine[] = withBase.map(({ netCents, baseCents }) => ({
    netUnitPrice: fromCents(netCents),
    lineBase: fromCents(baseCents),
  }));

  // group by (rate, treatment), preserving first-seen order for a stable invoice layout
  const groups = new Map<string, { rate: string; treatment: TaxTreatment; baseCents: bigint }>();
  for (const { line, baseCents } of withBase) {
    const key = `${line.taxRatePercent}|${line.taxTreatment}`;
    const existing = groups.get(key);
    if (existing) existing.baseCents += baseCents;
    else groups.set(key, { rate: line.taxRatePercent, treatment: line.taxTreatment, baseCents });
  }

  const taxGroups: TaxGroup[] = [...groups.values()].map(({ rate, treatment, baseCents }) => {
    const taxCents = isTaxable(treatment) ? applyRate(baseCents, toBips(rate)) : 0n;
    return {
      taxRatePercent: rate,
      taxTreatment: treatment,
      base: fromCents(baseCents),
      tax: fromCents(taxCents),
      legalNote: LEGAL_NOTES[treatment],
    };
  });

  const subtotalCents = withBase.reduce((acc, l) => acc + l.baseCents, 0n);
  const taxTotalCents = taxGroups.reduce((acc, g) => acc + toCents(g.tax), 0n);

  let withholdingCents = 0n;
  if (opts.withholdingRatePercent !== undefined && opts.withholdingRatePercent !== "") {
    const whBase = withBase.reduce((acc, l) => (l.line.subjectToWithholding ? acc + l.baseCents : acc), 0n);
    withholdingCents = applyRate(whBase, toBips(opts.withholdingRatePercent));
  }

  return {
    lines: computedLines,
    subtotal: fromCents(subtotalCents),
    taxGroups,
    taxTotal: fromCents(taxTotalCents),
    withholding: fromCents(withholdingCents),
    total: fromCents(subtotalCents + taxTotalCents - withholdingCents),
  };
}
