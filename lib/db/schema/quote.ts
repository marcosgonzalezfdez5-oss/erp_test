import { numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenant";
import { opportunities } from "./opportunity";
import { products } from "./product";

export const quotes = pgTable("quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id")
    .notNull()
    .references(() => opportunities.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Quote = typeof quotes.$inferSelect;

// unitPrice is a snapshot captured when the line item is added, not a live
// join to products.unitPrice — a quote's total must not silently change if
// the product's catalog price is edited later (CLAUDE.md §12). `discountPercent`
// / `discountAmount` / `netUnitPrice` / `unitCost` were added when the ERP money
// pipeline (`lib/money.ts`) was folded in, so a quote carries the same
// discount + cost snapshot the order it becomes will freeze. Quotes stay an
// ex-tax estimate — VAT is modelled on the order / invoice from the product.
export const quoteLineItems = pgTable("quote_line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  quoteId: uuid("quote_id")
    .notNull()
    .references(() => quotes.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "restrict" }),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
  unitOfMeasure: text("unit_of_measure").notNull().default("unit"),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }),
  netUnitPrice: numeric("net_unit_price", { precision: 12, scale: 2 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type QuoteLineItem = typeof quoteLineItems.$inferSelect;
