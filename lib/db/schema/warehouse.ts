import { sql } from "drizzle-orm";
import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenant";
import type { PostalAddress } from "./address";

/**
 * A physical stock location. Multi-warehouse from the start: stock levels and
 * every stock movement are warehouse-scoped. Exactly one warehouse per tenant
 * carries `isDefault` — enforced in `warehouseService`, and used as the
 * pre-selected fulfilling location when an order is confirmed.
 */
export const warehouses = pgTable(
  "warehouses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    address: jsonb("address").$type<PostalAddress>(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    // Codes are unique among live warehouses; a soft-deleted one frees its code.
    uniqueIndex("warehouses_tenant_code_unique")
      .on(table.tenantId, table.code)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export type Warehouse = typeof warehouses.$inferSelect;
