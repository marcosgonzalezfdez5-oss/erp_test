import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { ActorContext } from "@/lib/auth/actor";
import { requireRole } from "@/lib/auth/authorize";
import { orderLineItems } from "@/lib/db/schema/order";
import { products } from "@/lib/db/schema/product";
import { users } from "@/lib/db/schema/user";
import { warehouses } from "@/lib/db/schema/warehouse";
import {
  stockLevels,
  stockMovements,
  type StockLevel,
  type StockMovement,
  type StockMovementReason,
} from "@/lib/db/schema/inventory";
import { withTenantContext, type Tx } from "@/lib/db/tenant-context";
import { fromMilliUnits, toMilliUnits } from "@/lib/money";
import { recordAudit } from "./audit";
import { readSettings } from "./tenant-settings";

const MANAGER_ROLES: ActorContext["role"][] = ["admin", "sales_manager"];
export const MOVEMENT_PAGE_SIZE = 50;

const stockQuantity = z.number().positive().multipleOf(0.001).max(1_000_000);
const money = z.number().nonnegative().multipleOf(0.01);

// ---------------------------------------------------------------------------
// primitives

interface MovementParams {
  productId: string;
  warehouseId: string;
  reason: StockMovementReason;
  /** Signed `numeric(12,3)` string — the caller sets the sign. */
  quantityDelta: string;
  unitCost: string | null;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  actorUserId: string | null;
}

function touchesReserved(reason: StockMovementReason): boolean {
  return reason === "reservation" || reason === "reservation_release";
}

/**
 * Locks the `(product, warehouse)` stock-level row (`SELECT … FOR UPDATE`),
 * applies the signed delta to the right counter, and appends the ledger row —
 * all on the caller's transaction. The `FOR UPDATE` lock is what makes
 * `reserveForOrder` safe against two concurrent confirmations overselling.
 */
async function applyMovement(tx: Tx, tenantId: string, p: MovementParams): Promise<void> {
  await tx
    .insert(stockLevels)
    .values({ tenantId, productId: p.productId, warehouseId: p.warehouseId })
    .onConflictDoNothing({
      target: [stockLevels.tenantId, stockLevels.productId, stockLevels.warehouseId],
    });

  const [level] = await tx
    .select()
    .from(stockLevels)
    .where(
      and(
        eq(stockLevels.tenantId, tenantId),
        eq(stockLevels.productId, p.productId),
        eq(stockLevels.warehouseId, p.warehouseId),
      ),
    )
    .for("update");

  const delta = toMilliUnits(p.quantityDelta);
  const nextOnHand = touchesReserved(p.reason)
    ? level.quantityOnHand
    : fromMilliUnits(toMilliUnits(level.quantityOnHand) + delta);
  const nextReserved = touchesReserved(p.reason)
    ? fromMilliUnits(toMilliUnits(level.quantityReserved) + delta)
    : level.quantityReserved;

  await tx
    .update(stockLevels)
    .set({ quantityOnHand: nextOnHand, quantityReserved: nextReserved, updatedAt: new Date() })
    .where(eq(stockLevels.id, level.id));

  await tx.insert(stockMovements).values({
    tenantId,
    productId: p.productId,
    warehouseId: p.warehouseId,
    reason: p.reason,
    quantityDelta: p.quantityDelta,
    unitCost: p.unitCost,
    referenceType: p.referenceType,
    referenceId: p.referenceId,
    note: p.note,
    createdByUserId: p.actorUserId,
  });
}

async function requireTrackedProduct(tx: Tx, tenantId: string, productId: string): Promise<typeof products.$inferSelect> {
  const [product] = await tx
    .select()
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId), isNull(products.deletedAt)));
  if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
  if (!product.tracksInventory) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `"${product.name}" is not stock-tracked.` });
  }
  return product;
}

async function requireWarehouse(tx: Tx, tenantId: string, warehouseId: string): Promise<void> {
  const [wh] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.id, warehouseId), isNull(warehouses.deletedAt)));
  if (!wh) throw new TRPCError({ code: "NOT_FOUND", message: "Warehouse not found" });
}

function levelRow(tx: Tx, tenantId: string, productId: string, warehouseId: string) {
  return tx
    .select()
    .from(stockLevels)
    .where(
      and(
        eq(stockLevels.tenantId, tenantId),
        eq(stockLevels.productId, productId),
        eq(stockLevels.warehouseId, warehouseId),
      ),
    )
    .then((rows) => rows[0]);
}

// ---------------------------------------------------------------------------
// manual stock operations (manager+, audited)

export const receiveStockInput = z.object({
  productId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantity: stockQuantity,
  unitCost: money.optional(),
  note: z.string().trim().max(500).optional(),
});

export async function receiveStock(actor: ActorContext, rawInput: z.input<typeof receiveStockInput>): Promise<StockLevel> {
  requireRole(actor.role, MANAGER_ROLES);
  const input = receiveStockInput.parse(rawInput);
  return withTenantContext(actor.tenantId, async (tx) => {
    const product = await requireTrackedProduct(tx, actor.tenantId, input.productId);
    await requireWarehouse(tx, actor.tenantId, input.warehouseId);

    await applyMovement(tx, actor.tenantId, {
      productId: input.productId,
      warehouseId: input.warehouseId,
      reason: "receipt",
      quantityDelta: input.quantity.toFixed(3),
      unitCost: input.unitCost !== undefined ? input.unitCost.toFixed(2) : product.costPrice,
      referenceType: null,
      referenceId: null,
      note: input.note ?? null,
      actorUserId: actor.userId,
    });

    await recordAudit(tx, actor.tenantId, actor, {
      entityType: "product",
      entityId: input.productId,
      action: "stock.receive",
      summary: `Received ${input.quantity} ${product.unitOfMeasure} of "${product.name}"`,
    });

    return levelRow(tx, actor.tenantId, input.productId, input.warehouseId);
  });
}

export const adjustStockInput = z.object({
  productId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  newOnHand: z.number().min(0).multipleOf(0.001).max(1_000_000),
  note: z.string().trim().min(1).max(500),
});

export async function adjustStock(actor: ActorContext, rawInput: z.input<typeof adjustStockInput>): Promise<StockLevel> {
  requireRole(actor.role, MANAGER_ROLES);
  const input = adjustStockInput.parse(rawInput);
  return withTenantContext(actor.tenantId, async (tx) => {
    const product = await requireTrackedProduct(tx, actor.tenantId, input.productId);
    await requireWarehouse(tx, actor.tenantId, input.warehouseId);

    const current = await levelRow(tx, actor.tenantId, input.productId, input.warehouseId);
    const currentOnHand = current?.quantityOnHand ?? "0.000";
    const deltaMilli = toMilliUnits(input.newOnHand.toFixed(3)) - toMilliUnits(currentOnHand);
    if (deltaMilli === 0n) return current ?? (await ensureLevel(tx, actor.tenantId, input.productId, input.warehouseId));

    await applyMovement(tx, actor.tenantId, {
      productId: input.productId,
      warehouseId: input.warehouseId,
      reason: "adjustment",
      quantityDelta: fromMilliUnits(deltaMilli),
      unitCost: product.costPrice,
      referenceType: null,
      referenceId: null,
      note: input.note,
      actorUserId: actor.userId,
    });

    await recordAudit(tx, actor.tenantId, actor, {
      entityType: "product",
      entityId: input.productId,
      action: "stock.adjust",
      summary: `Adjusted "${product.name}" on hand to ${input.newOnHand}`,
      diff: { quantityOnHand: { from: currentOnHand, to: input.newOnHand.toFixed(3) } },
    });

    return levelRow(tx, actor.tenantId, input.productId, input.warehouseId);
  });
}

export const transferStockInput = z.object({
  productId: z.string().uuid(),
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  quantity: stockQuantity,
  note: z.string().trim().max(500).optional(),
});

export async function transferStock(
  actor: ActorContext,
  rawInput: z.input<typeof transferStockInput>,
): Promise<{ from: StockLevel; to: StockLevel }> {
  requireRole(actor.role, MANAGER_ROLES);
  const input = transferStockInput.parse(rawInput);
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Source and destination warehouse must differ." });
  }
  return withTenantContext(actor.tenantId, async (tx) => {
    const product = await requireTrackedProduct(tx, actor.tenantId, input.productId);
    await requireWarehouse(tx, actor.tenantId, input.fromWarehouseId);
    await requireWarehouse(tx, actor.tenantId, input.toWarehouseId);

    const source = await levelRow(tx, actor.tenantId, input.productId, input.fromWarehouseId);
    const available = toMilliUnits(source?.quantityOnHand ?? "0");
    if (available < toMilliUnits(input.quantity.toFixed(3))) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Only ${fromMilliUnits(available)} of "${product.name}" on hand at the source warehouse.`,
      });
    }

    await applyMovement(tx, actor.tenantId, {
      productId: input.productId,
      warehouseId: input.fromWarehouseId,
      reason: "transfer_out",
      quantityDelta: `-${input.quantity.toFixed(3)}`,
      unitCost: product.costPrice,
      referenceType: "warehouse_transfer",
      referenceId: input.toWarehouseId,
      note: input.note ?? null,
      actorUserId: actor.userId,
    });
    await applyMovement(tx, actor.tenantId, {
      productId: input.productId,
      warehouseId: input.toWarehouseId,
      reason: "transfer_in",
      quantityDelta: input.quantity.toFixed(3),
      unitCost: product.costPrice,
      referenceType: "warehouse_transfer",
      referenceId: input.fromWarehouseId,
      note: input.note ?? null,
      actorUserId: actor.userId,
    });

    await recordAudit(tx, actor.tenantId, actor, {
      entityType: "product",
      entityId: input.productId,
      action: "stock.transfer",
      summary: `Transferred ${input.quantity} ${product.unitOfMeasure} of "${product.name}" between warehouses`,
    });

    return {
      from: await levelRow(tx, actor.tenantId, input.productId, input.fromWarehouseId),
      to: await levelRow(tx, actor.tenantId, input.productId, input.toWarehouseId),
    };
  });
}

async function ensureLevel(tx: Tx, tenantId: string, productId: string, warehouseId: string): Promise<StockLevel> {
  await tx
    .insert(stockLevels)
    .values({ tenantId, productId, warehouseId })
    .onConflictDoNothing({ target: [stockLevels.tenantId, stockLevels.productId, stockLevels.warehouseId] });
  return levelRow(tx, tenantId, productId, warehouseId);
}

// ---------------------------------------------------------------------------
// order lifecycle hooks (called from orderService, inside its transaction)

/**
 * Reserves each inventory-tracked order line against the order's warehouse.
 * All-or-nothing: if `tenant_settings.allow_negative_stock` is false and any
 * line is short, nothing is reserved and a `PRECONDITION_FAILED` names the
 * short products. When negative stock is allowed, short lines are still
 * reserved and flagged `backordered`.
 */
export async function reserveForOrder(
  tx: Tx,
  tenantId: string,
  order: { id: string; warehouseId: string | null },
  actorUserId: string | null,
): Promise<void> {
  if (!order.warehouseId) return;
  const warehouseId = order.warehouseId;
  const settings = await readSettings(tx, tenantId);

  const lines = await tx
    .select({ li: orderLineItems, product: products })
    .from(orderLineItems)
    .innerJoin(products, eq(orderLineItems.productId, products.id))
    .where(and(eq(orderLineItems.tenantId, tenantId), eq(orderLineItems.orderId, order.id)))
    .orderBy(asc(orderLineItems.createdAt));

  const plan: Array<{ lineId: string; productId: string; quantity: string; backordered: boolean }> = [];
  const short: string[] = [];

  for (const { li, product } of lines) {
    if (!product.tracksInventory) continue;

    await tx
      .insert(stockLevels)
      .values({ tenantId, productId: product.id, warehouseId })
      .onConflictDoNothing({ target: [stockLevels.tenantId, stockLevels.productId, stockLevels.warehouseId] });
    const [locked] = await tx
      .select()
      .from(stockLevels)
      .where(levelMatch(tenantId, product.id, warehouseId))
      .for("update");

    const availableMilli = toMilliUnits(locked.quantityOnHand) - toMilliUnits(locked.quantityReserved);
    const backordered = availableMilli < toMilliUnits(li.quantity);
    if (backordered && !settings.allowNegativeStock) short.push(product.name);
    plan.push({ lineId: li.id, productId: product.id, quantity: li.quantity, backordered });
  }

  if (short.length > 0) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Insufficient stock: ${short.join(", ")}` });
  }

  for (const item of plan) {
    await applyMovement(tx, tenantId, {
      productId: item.productId,
      warehouseId,
      reason: "reservation",
      quantityDelta: item.quantity,
      unitCost: null,
      referenceType: "order",
      referenceId: order.id,
      note: null,
      actorUserId,
    });
    if (item.backordered) {
      await tx.update(orderLineItems).set({ backordered: true }).where(eq(orderLineItems.id, item.lineId));
    }
  }
}

function levelMatch(tenantId: string, productId: string, warehouseId: string) {
  return and(
    eq(stockLevels.tenantId, tenantId),
    eq(stockLevels.productId, productId),
    eq(stockLevels.warehouseId, warehouseId),
  );
}

/** Releases whatever this order still has reserved (idempotent). */
export async function releaseReservation(
  tx: Tx,
  tenantId: string,
  orderId: string,
  actorUserId: string | null,
): Promise<void> {
  const outstanding = await tx
    .select({
      productId: stockMovements.productId,
      warehouseId: stockMovements.warehouseId,
      net: sql<string>`sum(case when ${stockMovements.reason} = 'reservation' then ${stockMovements.quantityDelta} else -${stockMovements.quantityDelta} end)`,
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.tenantId, tenantId),
        eq(stockMovements.referenceType, "order"),
        eq(stockMovements.referenceId, orderId),
        inArray(stockMovements.reason, ["reservation", "reservation_release"]),
      ),
    )
    .groupBy(stockMovements.productId, stockMovements.warehouseId);

  for (const row of outstanding) {
    const netMilli = toMilliUnits(row.net ?? "0");
    if (netMilli <= 0n) continue;
    await applyMovement(tx, tenantId, {
      productId: row.productId,
      warehouseId: row.warehouseId,
      reason: "reservation_release",
      quantityDelta: `-${fromMilliUnits(netMilli)}`,
      unitCost: null,
      referenceType: "order",
      referenceId: orderId,
      note: null,
      actorUserId,
    });
  }
}

interface SaleParams {
  productId: string;
  /** Warehouse the goods physically leave from. */
  saleWarehouseId: string;
  /** Where the order reserved this line, if it did (usually == saleWarehouseId). */
  reservationWarehouseId: string | null;
  quantity: string; // numeric(12,3)
  unitCost: string | null;
  orderId: string;
  shipmentId: string;
  actorUserId: string | null;
}

/**
 * Applies a dispatched shipment line to stock, inside the shipment
 * transaction: a `sale` movement drops on-hand at the ship-from warehouse, and
 * up to `quantity` of the order's outstanding reservation is released
 * (converting the reservation into an actual drawdown). Called by
 * `shipmentService.transitionShipment` on the `shipped` transition.
 */
export async function recordSale(tx: Tx, tenantId: string, p: SaleParams): Promise<void> {
  await applyMovement(tx, tenantId, {
    productId: p.productId,
    warehouseId: p.saleWarehouseId,
    reason: "sale",
    quantityDelta: `-${p.quantity}`,
    unitCost: p.unitCost,
    referenceType: "shipment",
    referenceId: p.shipmentId,
    note: null,
    actorUserId: p.actorUserId,
  });

  if (!p.reservationWarehouseId) return;
  const [row] = await tx
    .select({
      net: sql<string>`coalesce(sum(case when ${stockMovements.reason} = 'reservation' then ${stockMovements.quantityDelta} else -${stockMovements.quantityDelta} end), 0)`,
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.tenantId, tenantId),
        eq(stockMovements.productId, p.productId),
        eq(stockMovements.referenceType, "order"),
        eq(stockMovements.referenceId, p.orderId),
        inArray(stockMovements.reason, ["reservation", "reservation_release"]),
      ),
    );

  const outstanding = toMilliUnits(row?.net ?? "0");
  if (outstanding <= 0n) return;
  const shipped = toMilliUnits(p.quantity);
  const release = outstanding < shipped ? outstanding : shipped;
  await applyMovement(tx, tenantId, {
    productId: p.productId,
    warehouseId: p.reservationWarehouseId,
    reason: "reservation_release",
    quantityDelta: `-${fromMilliUnits(release)}`,
    unitCost: null,
    referenceType: "order",
    referenceId: p.orderId,
    note: null,
    actorUserId: p.actorUserId,
  });
}

interface ReturnParams {
  productId: string;
  /** Warehouse the returned goods are restocked into. */
  warehouseId: string;
  quantity: string; // numeric(12,3), positive
  unitCost: string | null;
  shipmentId: string;
  note: string | null;
  actorUserId: string | null;
}

/**
 * Restocks a customer return, inside the return transaction: a `return`
 * movement adds the goods back on hand at their original cost. Called by
 * `returnService.recordReturn`.
 */
export async function recordReturnMovement(tx: Tx, tenantId: string, p: ReturnParams): Promise<void> {
  await applyMovement(tx, tenantId, {
    productId: p.productId,
    warehouseId: p.warehouseId,
    reason: "return",
    quantityDelta: p.quantity,
    unitCost: p.unitCost,
    referenceType: "shipment",
    referenceId: p.shipmentId,
    note: p.note,
    actorUserId: p.actorUserId,
  });
}

// ---------------------------------------------------------------------------
// reads

export const stockLevelsFilter = z
  .object({
    productId: z.string().uuid().optional(),
    warehouseId: z.string().uuid().optional(),
    lowStockOnly: z.boolean().optional(),
  })
  .optional();

export async function getStockLevels(tenantId: string, filter?: z.infer<typeof stockLevelsFilter>) {
  const rows = await withTenantContext(tenantId, (tx) =>
    tx
      .select({
        productId: stockLevels.productId,
        productName: products.name,
        sku: products.sku,
        unitOfMeasure: products.unitOfMeasure,
        reorderPoint: products.reorderPoint,
        warehouseId: stockLevels.warehouseId,
        warehouseName: warehouses.name,
        quantityOnHand: stockLevels.quantityOnHand,
        quantityReserved: stockLevels.quantityReserved,
        updatedAt: stockLevels.updatedAt,
      })
      .from(stockLevels)
      .innerJoin(products, eq(stockLevels.productId, products.id))
      .innerJoin(warehouses, eq(stockLevels.warehouseId, warehouses.id))
      .where(
        and(
          eq(stockLevels.tenantId, tenantId),
          filter?.productId ? eq(stockLevels.productId, filter.productId) : undefined,
          filter?.warehouseId ? eq(stockLevels.warehouseId, filter.warehouseId) : undefined,
        ),
      )
      .orderBy(asc(products.name), asc(warehouses.name)),
  );

  return rows
    .map((row) => {
      const availableMilli = toMilliUnits(row.quantityOnHand) - toMilliUnits(row.quantityReserved);
      const lowStock =
        row.reorderPoint !== null && availableMilli <= toMilliUnits(row.reorderPoint);
      return { ...row, quantityAvailable: fromMilliUnits(availableMilli), lowStock };
    })
    .filter((row) => !filter?.lowStockOnly || row.lowStock);
}

export const listMovementsFilter = z
  .object({
    productId: z.string().uuid().optional(),
    warehouseId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(200).default(MOVEMENT_PAGE_SIZE),
  })
  .optional();

export function listMovements(
  tenantId: string,
  filter?: z.input<typeof listMovementsFilter>,
): Promise<
  Array<
    Pick<StockMovement, "id" | "reason" | "quantityDelta" | "unitCost" | "note" | "referenceType" | "referenceId" | "createdAt"> & {
      productName: string;
      warehouseName: string;
      actorEmail: string | null;
    }
  >
> {
  const limit = filter?.limit ?? MOVEMENT_PAGE_SIZE;
  return withTenantContext(tenantId, (tx) =>
    tx
      .select({
        id: stockMovements.id,
        reason: stockMovements.reason,
        quantityDelta: stockMovements.quantityDelta,
        unitCost: stockMovements.unitCost,
        note: stockMovements.note,
        referenceType: stockMovements.referenceType,
        referenceId: stockMovements.referenceId,
        createdAt: stockMovements.createdAt,
        productName: products.name,
        warehouseName: warehouses.name,
        actorEmail: users.email,
      })
      .from(stockMovements)
      .innerJoin(products, eq(stockMovements.productId, products.id))
      .innerJoin(warehouses, eq(stockMovements.warehouseId, warehouses.id))
      .leftJoin(users, eq(stockMovements.createdByUserId, users.id))
      .where(
        and(
          eq(stockMovements.tenantId, tenantId),
          filter?.productId ? eq(stockMovements.productId, filter.productId) : undefined,
          filter?.warehouseId ? eq(stockMovements.warehouseId, filter.warehouseId) : undefined,
        ),
      )
      .orderBy(desc(stockMovements.createdAt))
      .limit(limit),
  );
}
