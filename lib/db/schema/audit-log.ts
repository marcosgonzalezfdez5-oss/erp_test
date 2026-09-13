import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenant";
import { users } from "./user";

/**
 * A cross-cutting trail for legally-significant events — invoice issue /
 * rectify, stock adjustments — written by the invoice, credit-note, shipment
 * and inventory services only (CLAUDE.md §17: this is the concrete need that was
 * being waited for, not a general framework). Each entry is inserted inside the
 * same transaction as the mutation it records, so the trail can never drift
 * from what actually happened.
 */
export const auditLogEntries = pgTable(
  "audit_log_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }), // null = system actor
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(), // e.g. "invoice.issue", "stock.adjust"
    summary: text("summary").notNull(),
    diff: jsonb("diff").$type<Record<string, { from: unknown; to: unknown }>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_log_entries_tenant_entity_idx").on(table.tenantId, table.entityType, table.entityId),
    index("audit_log_entries_tenant_created_idx").on(table.tenantId, table.createdAt),
  ],
);

export type AuditLogEntry = typeof auditLogEntries.$inferSelect;
