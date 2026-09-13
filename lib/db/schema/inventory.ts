import { index, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenant";
import { users } from "./user";
import { products } from "./product";
import { warehouses } from "./warehouse";

/**
 * Stock control (CLAUDE.md ERP plan, Milestone 2). `stock_movements` is an
 * append-only ledger — never updated or deleted — and `stock_levels` is the
 * running total kept in step with it inside the same transaction. The ledger is
 * the source of truth: `quantity_on_hand` must always equal the sum of movement
 * deltas whose reason touches on-hand, and `quantity_reserved` the sum of the
 * `reservation` / `reservation_release` deltas.
 */
export const stockMovementReasonEnum = pgEnum("stock_movement_reason", [
  "receipt", // goods in (+on hand)
  "adjustment", // manual correction (± on hand)
  "sale", // dispatched on a shipment (− on hand) — Milestone 3
  "return", // customer return (+ on hand) — Milestone 4
  "transfer_out", // − on hand, leaving a warehouse
  "transfer_in", // + on hand, arriving at a warehouse
  "reservation", // + reserved, on an order confirm
  "reservation_release", // − reserved, on an order cancel
]);

/** Reasons that move physical stock rather than the reservation counter. */
export const ON_HAND_REASONS = [
  "receipt",
  "adjustment",
  "sale",
  "return",
  "transfer_out",
  "transfer_in",
] as const;

export const stockLevels = pgTable(
  "stock_levels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    quantityOnHand: numeric("quantity_on_hand", { precision: 12, scale: 3 }).notNull().default("0"),
    quantityReserved: numeric("quantity_reserved", { precision: 12, scale: 3 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("stock_levels_tenant_product_warehouse_unique").on(
      table.tenantId,
      table.productId,
      table.warehouseId,
    ),
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    reason: stockMovementReasonEnum("reason").notNull(),
    quantityDelta: numeric("quantity_delta", { precision: 12, scale: 3 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 12, scale: 2 }), // snapshot, for later valuation / margin
    // Polymorphic, no FK — kept for the audit trail even if the order/shipment is deleted.
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    note: text("note"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("stock_movements_tenant_product_warehouse_idx").on(table.tenantId, table.productId, table.warehouseId),
    index("stock_movements_tenant_reference_idx").on(table.tenantId, table.referenceType, table.referenceId),
  ],
);

export type StockLevel = typeof stockLevels.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;
export type StockMovementReason = (typeof stockMovementReasonEnum.enumValues)[number];
