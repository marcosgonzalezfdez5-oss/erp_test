import { index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { CARRIERS } from "@/lib/shipping/carriers";
import { tenants } from "./tenant";
import { users } from "./user";
import { orders, orderLineItems } from "./order";
import { products } from "./product";
import { warehouses } from "./warehouse";
import type { PostalAddress } from "./address";

/**
 * A physical dispatch of goods against one order, from one warehouse
 * (CLAUDE.md ERP plan, Milestone 3). Partial and split shipments are
 * first-class — one order line can be covered by several shipments. The
 * `shipped` transition is the consequential one: it writes `sale` stock
 * movements, converts the order's reservation into an actual drawdown, and
 * recomputes the order's fulfilment status. Carrier + tracking are entered by
 * hand — no carrier API in v1.
 */
export const shipmentStatusEnum = pgEnum("shipment_status", [
  "draft",
  "picking",
  "packed",
  "shipped",
  "in_transit",
  "delivered",
  "cancelled",
  "exception",
]);

export const carrierEnum = pgEnum("carrier", CARRIERS);

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    shipFromWarehouseId: uuid("ship_from_warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    number: text("number"), // assigned on the shipped transition, from the DN- sequence
    status: shipmentStatusEnum("status").notNull().default("draft"),
    carrier: carrierEnum("carrier"),
    service: text("service"),
    trackingNumber: text("tracking_number"),
    trackingUrl: text("tracking_url"),
    shipToAddress: jsonb("ship_to_address").$type<PostalAddress>(),
    packageCount: integer("package_count").notNull().default(1),
    weightGrams: integer("weight_grams"),
    shippingCost: numeric("shipping_cost", { precision: 12, scale: 2 }),
    notes: text("notes"),
    // Set once the shipped transition has applied its stock movements — the idempotency guard.
    stockAppliedAt: timestamp("stock_applied_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("shipments_tenant_order_idx").on(table.tenantId, table.orderId)],
);

export const shipmentLineItems = pgTable("shipment_line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  shipmentId: uuid("shipment_id")
    .notNull()
    .references(() => shipments.id, { onDelete: "cascade" }),
  orderLineItemId: uuid("order_line_item_id")
    .notNull()
    .references(() => orderLineItems.id, { onDelete: "restrict" }),
  productId: uuid("product_id").references(() => products.id, { onDelete: "restrict" }),
  description: text("description").notNull(), // snapshot
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }), // snapshot, carried onto the sale movement
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
});

export type Shipment = typeof shipments.$inferSelect;
export type ShipmentLineItem = typeof shipmentLineItems.$inferSelect;
export type ShipmentStatus = (typeof shipmentStatusEnum.enumValues)[number];
