import { boolean, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenant";
import { taxTreatmentEnum } from "./tax";

export const unitOfMeasureEnum = pgEnum("unit_of_measure", [
  "unit",
  "kg",
  "g",
  "l",
  "ml",
  "m",
  "cm",
  "m2",
  "m3",
  "hour",
  "box",
  "pallet",
]);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sku: text("sku"),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    unitOfMeasure: unitOfMeasureEnum("unit_of_measure").notNull().default("unit"),
    // Snapshotted onto every stock movement and order/invoice line so margin is
    // recoverable later (CLAUDE.md ERP plan — cost capture without a valuation engine).
    costPrice: numeric("cost_price", { precision: 12, scale: 2 }),
    // null → fall back to tenant_settings.default_tax_rate_percent at line creation.
    taxRatePercent: numeric("tax_rate_percent", { precision: 5, scale: 2 }),
    taxTreatment: taxTreatmentEnum("tax_treatment").notNull().default("standard"),
    subjectToWithholding: boolean("subject_to_withholding").notNull().default(false),
    // false for services / digital goods that carry no stock.
    tracksInventory: boolean("tracks_inventory").notNull().default(true),
    reorderPoint: numeric("reorder_point", { precision: 12, scale: 3 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    // SKU is unique among live products; a soft-deleted one frees its SKU.
    uniqueIndex("products_tenant_sku_unique")
      .on(table.tenantId, table.sku)
      .where(sql`${table.sku} is not null and ${table.deletedAt} is null`),
  ],
);

export type Product = typeof products.$inferSelect;
