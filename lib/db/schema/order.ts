import { sql } from "drizzle-orm";
import { boolean, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenant";
import { accounts } from "./account";
import { opportunities } from "./opportunity";
import { products } from "./product";
import { quotes } from "./quote";
import { taxTreatmentEnum } from "./tax";
import type { PostalAddress } from "./address";
import type { TaxGroup } from "@/lib/money";

/**
 * A real sales order (CLAUDE.md ERP plan, Milestone 1). Created as a `draft`
 * when an opportunity is won (lines snapshotted from its latest quote) or
 * entered standalone for a repeat customer; a human then `confirm`s it, which
 * assigns the `SO-` number and (from Milestone 2) reserves stock.
 */
export const orderStatusEnum = pgEnum("order_status", [
  "draft",
  "confirmed",
  "partially_fulfilled",
  "fulfilled",
  "cancelled",
]);

/** Cached from shipment coverage of the order's lines (maintained by shipmentService). */
export const orderFulfillmentStatusEnum = pgEnum("order_fulfillment_status", [
  "unfulfilled",
  "partially_fulfilled",
  "fulfilled",
]);

/** Cached from invoice coverage of the order's lines (maintained by invoiceService). */
export const orderInvoiceStatusEnum = pgEnum("order_invoice_status", [
  "uninvoiced",
  "partially_invoiced",
  "invoiced",
]);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // Nullable — a standalone order has no opportunity. Still at most one order
    // per opportunity (partial unique index below).
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    quoteId: uuid("quote_id").references(() => quotes.id, { onDelete: "set null" }),
    number: text("number"), // assigned on confirm, from the SO- sequence
    status: orderStatusEnum("status").notNull().default("draft"),
    fulfillmentStatus: orderFulfillmentStatusEnum("fulfillment_status").notNull().default("unfulfilled"),
    invoiceStatus: orderInvoiceStatusEnum("invoice_status").notNull().default("uninvoiced"),
    warehouseId: uuid("warehouse_id"), // fulfilling location, chosen on confirm (no FK — set null-safe)
    currency: text("currency").notNull().default("EUR"),
    subtotalAmount: numeric("subtotal_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    withholdingAmount: numeric("withholding_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    taxSummary: jsonb("tax_summary").$type<TaxGroup[]>(),
    billingAddress: jsonb("billing_address").$type<PostalAddress>(),
    shippingAddress: jsonb("shipping_address").$type<PostalAddress>(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("orders_opportunity_unique")
      .on(table.opportunityId)
      .where(sql`${table.opportunityId} is not null`),
  ],
);

export type Order = typeof orders.$inferSelect;

/**
 * A snapshotted order line — price, discount, tax treatment and unit cost are
 * all frozen when the line is created, exactly like `quote_line_items.unitPrice`
 * (CLAUDE.md §12). `productId` is nullable so a free-text line is possible.
 */
export const orderLineItems = pgTable("order_line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  productId: uuid("product_id").references(() => products.id, { onDelete: "restrict" }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  unitOfMeasure: text("unit_of_measure").notNull().default("unit"),
  listUnitPrice: numeric("list_unit_price", { precision: 12, scale: 2 }).notNull(),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }),
  netUnitPrice: numeric("net_unit_price", { precision: 12, scale: 2 }).notNull(),
  taxRatePercent: numeric("tax_rate_percent", { precision: 5, scale: 2 }).notNull(),
  taxTreatment: taxTreatmentEnum("tax_treatment").notNull().default("standard"),
  subjectToWithholding: boolean("subject_to_withholding").notNull().default(false),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }),
  lineBaseAmount: numeric("line_base_amount", { precision: 12, scale: 2 }).notNull(),
  quantityShipped: numeric("quantity_shipped", { precision: 12, scale: 3 }).notNull().default("0"),
  quantityInvoiced: numeric("quantity_invoiced", { precision: 12, scale: 3 }).notNull().default("0"),
  backordered: boolean("backordered").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OrderLineItem = typeof orderLineItems.$inferSelect;
export type OrderStatus = (typeof orderStatusEnum.enumValues)[number];
export type OrderFulfillmentStatus = (typeof orderFulfillmentStatusEnum.enumValues)[number];
export type OrderInvoiceStatus = (typeof orderInvoiceStatusEnum.enumValues)[number];
