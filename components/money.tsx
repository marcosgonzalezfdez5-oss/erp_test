import { sumAmounts } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Formats a numeric(12,2) decimal string ("1234.5", "-19.99") as currency
 * without ever parsing it into a float — string/integer manipulation only,
 * consistent with CLAUDE.md §12's "never do arithmetic on money via
 * parseFloat" rule. This is display formatting of an already-final value,
 * not arithmetic, but staying off float keeps the whole money path uniform.
 */
export function formatMoney(value: string): string {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = trimmed.replace(/^-/, "");
  const [wholeRaw, fractionRaw = ""] = unsigned.split(".");
  const whole = (wholeRaw || "0").replace(/^0+(?=\d)/, "");
  const fraction = (fractionRaw + "00").slice(0, 2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "−" : ""}$${grouped}.${fraction}`;
}

export function Money({ value, className }: { value: string; className?: string }) {
  return <span className={cn("font-mono tabular-nums", className)}>{formatMoney(value)}</span>;
}

/** Sums numeric(12,2) decimal strings exactly (CLAUDE.md §12) and returns a decimal string. */
export function sumMoney(values: string[]): string {
  return sumAmounts(values);
}
