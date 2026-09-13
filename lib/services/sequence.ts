import { sql } from "drizzle-orm";
import { sequences, type SequenceKind } from "@/lib/db/schema/sequence";
import { withTenantContext, type Tx } from "@/lib/db/tenant-context";

/**
 * Per-tenant, per-year gapless document numbering (CLAUDE.md §12 — a legal
 * requirement in Spain / much of the EU).
 *
 * `allocate` is called **inside the caller's transaction** (e.g. from
 * `invoiceService.issueInvoice`): the `INSERT … ON CONFLICT DO UPDATE` bumps
 * `last_number` and takes a row lock, so a concurrent allocation blocks until
 * this transaction commits and then reads the incremented value — the numbers
 * come out 1, 2, 3 with no gaps. If the caller's transaction rolls back, the
 * increment is undone and the number is released.
 */
export async function allocate(tx: Tx, tenantId: string, kind: SequenceKind, period: number): Promise<number> {
  const [row] = await tx
    .insert(sequences)
    .values({ tenantId, kind, period, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [sequences.tenantId, sequences.kind, sequences.period],
      set: { lastNumber: sql`${sequences.lastNumber} + 1`, updatedAt: new Date() },
    })
    .returning({ lastNumber: sequences.lastNumber });
  return row.lastNumber;
}

/** Convenience wrapper that runs `allocate` in its own transaction. */
export function nextNumber(tenantId: string, kind: SequenceKind, period: number): Promise<number> {
  return withTenantContext(tenantId, (tx) => allocate(tx, tenantId, kind, period));
}

/**
 * Renders a human-readable document number from a template.
 *   {YYYY} → 4-digit period      {YY} → 2-digit period
 *   {SEQ}  → counter             {SEQ:n} → counter zero-padded to n digits
 */
export function formatDocumentNumber(template: string, period: number, seq: number): string {
  return template
    .replace(/\{YYYY\}/g, String(period).padStart(4, "0"))
    .replace(/\{YY\}/g, String(period % 100).padStart(2, "0"))
    .replace(/\{SEQ(?::(\d+))?\}/g, (_match, pad?: string) =>
      pad ? String(seq).padStart(Number(pad), "0") : String(seq),
    );
}
