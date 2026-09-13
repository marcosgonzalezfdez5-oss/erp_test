import { integer, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenant";

/**
 * Per-tenant, per-year gapless document numbering. One mechanism, one row per
 * `(tenant, kind, period)`; `sequenceService.allocate()` bumps `lastNumber`
 * inside the issuing transaction, so a rollback releases the number and two
 * concurrent issuers serialise on the row lock. Gapless sequential numbering
 * is a legal requirement for invoices in Spain / much of the EU (CLAUDE.md §12).
 */
export const sequenceKindEnum = pgEnum("sequence_kind", ["order", "delivery_note", "invoice", "credit_note"]);

export const sequences = pgTable(
  "sequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: sequenceKindEnum("kind").notNull(),
    period: integer("period").notNull(), // calendar year, e.g. 2026
    lastNumber: integer("last_number").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("sequences_tenant_kind_period_unique").on(table.tenantId, table.kind, table.period)],
);

export type Sequence = typeof sequences.$inferSelect;
export type SequenceKind = (typeof sequenceKindEnum.enumValues)[number];
