import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenant";
import { opportunities } from "./opportunity";

// Deliberately a stub for V1 (CLAUDE.md §6/§19): no fulfillment, line items,
// or inventory — just a marker that an opportunity converted, created
// automatically when it moves into a "won" pipeline stage.
export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id")
    .notNull()
    .unique()
    .references(() => opportunities.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Order = typeof orders.$inferSelect;
