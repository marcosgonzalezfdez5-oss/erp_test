import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { ActorContext } from "@/lib/auth/actor";
import { isSystemActor } from "@/lib/auth/actor";
import { orders, orderLineItems, type OrderFulfillmentStatus, type OrderStatus } from "@/lib/db/schema/order";
import { products } from "@/lib/db/schema/product";
import { warehouses } from "@/lib/db/schema/warehouse";
import {
  carrierEnum,
  shipmentLineItems,
  shipments,
  shipmentStatusEnum,
  type Shipment,
  type ShipmentLineItem,
  type ShipmentStatus,
} from "@/lib/db/schema/shipment";
import { withTenantContext, type Tx } from "@/lib/db/tenant-context";
import { fromMilliUnits, toMilliUnits } from "@/lib/money";
import { trackingUrlFor, type Carrier } from "@/lib/shipping/carriers";
import { recordAudit } from "./audit";
import { recordSale } from "./inventory";
import { allocate as allocateSequence, formatDocumentNumber } from "./sequence";
import { readSettings } from "./tenant-settings";

export const SHIPMENT_PAGE_SIZE = 20;

const lineQuantity = z.number().positive().multipleOf(0.001).max(1_000_000);

/** Statuses a shipment may move to from its current one. */
const ALLOWED_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  draft: ["picking", "packed", "shipped", "cancelled"],
  picking: ["packed", "shipped", "cancelled"],
  packed: ["shipped", "cancelled"],
  shipped: ["in_transit", "delivered", "exception"],
  in_transit: ["delivered", "exception"],
  delivered: [],
  cancelled: [],
  exception: ["in_transit", "delivered"],
};

const EDITABLE_STATUSES: ShipmentStatus[] = ["draft", "picking", "packed"];

// ---------------------------------------------------------------------------
// helpers

async function requireShipment(tx: Tx, tenantId: string, id: string, forUpdate = false): Promise<Shipment> {
  const base = tx
    .select()
    .from(shipments)
    .where(and(eq(shipments.tenantId, tenantId), eq(shipments.id, id), isNull(shipments.deletedAt)));
  const [row] = await (forUpdate ? base.for("update") : base);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Shipment not found" });
  return row;
}

/** Quantity of an order line already committed to live (non-cancelled) shipments. */
async function committedQuantityMilli(tx: Tx, tenantId: string, orderLineItemId: string): Promise<bigint> {
  const [row] = await tx
    .select({
      total: sql<string>`coalesce(sum(${shipmentLineItems.quantity}), 0)`,
    })
    .from(shipmentLineItems)
    .innerJoin(shipments, eq(shipmentLineItems.shipmentId, shipments.id))
    .where(
      and(
        eq(shipmentLineItems.tenantId, tenantId),
        eq(shipmentLineItems.orderLineItemId, orderLineItemId),
        isNull(shipments.deletedAt),
        ne(shipments.status, "cancelled"),
      ),
    );
  return toMilliUnits(row?.total ?? "0");
}

function resolveTrackingUrl(
  carrier: Carrier | null | undefined,
  trackingNumber: string | null | undefined,
  explicit: string | null | undefined,
): string | null {
  if (explicit) return explicit;
  if (!carrier) return null;
  return trackingUrlFor(carrier, trackingNumber ?? null);
}

/** Recomputes the order's cached fulfilment status from its lines' shipped quantities. */
export async function recomputeFulfillment(tx: Tx, tenantId: string, orderId: string): Promise<void> {
  const lines = await tx
    .select({ quantity: orderLineItems.quantity, quantityShipped: orderLineItems.quantityShipped })
    .from(orderLineItems)
    .where(and(eq(orderLineItems.tenantId, tenantId), eq(orderLineItems.orderId, orderId)));

  let anyShipped = false;
  let allShipped = lines.length > 0;
  for (const line of lines) {
    const shipped = toMilliUnits(line.quantityShipped);
    if (shipped > 0n) anyShipped = true;
    if (shipped < toMilliUnits(line.quantity)) allShipped = false;
  }
  const fulfillment: OrderFulfillmentStatus = allShipped
    ? "fulfilled"
    : anyShipped
      ? "partially_fulfilled"
      : "unfulfilled";

  const [order] = await tx
    .select({ status: orders.status })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)));

  // Keep the order's lifecycle status in step while it's in a fulfilment phase.
  const lifecycle: OrderStatus[] = ["confirmed", "partially_fulfilled", "fulfilled"];
  const nextStatus: OrderStatus = lifecycle.includes(order.status)
    ? fulfillment === "fulfilled"
      ? "fulfilled"
      : fulfillment === "partially_fulfilled"
        ? "partially_fulfilled"
        : "confirmed"
    : order.status;

  await tx
    .update(orders)
    .set({ fulfillmentStatus: fulfillment, status: nextStatus, updatedAt: new Date() })
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)));
}

// ---------------------------------------------------------------------------
// create + edit (draft-ish only)

export const createShipmentInput = z.object({
  orderId: z.string().uuid(),
  shipFromWarehouseId: z.string().uuid().optional(),
  lines: z
    .array(z.object({ orderLineItemId: z.string().uuid(), quantity: lineQuantity }))
    .min(1),
  carrier: z.enum(carrierEnum.enumValues).optional(),
  service: z.string().trim().max(120).optional(),
  trackingNumber: z.string().trim().max(120).optional(),
  packageCount: z.number().int().min(1).max(1000).optional(),
  weightGrams: z.number().int().min(0).max(100_000_000).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createShipment(
  actor: ActorContext,
  rawInput: z.input<typeof createShipmentInput>,
): Promise<{ shipment: Shipment; lineItems: ShipmentLineItem[] }> {
  const input = createShipmentInput.parse(rawInput);
  const { tenantId } = actor;
  return withTenantContext(tenantId, async (tx) => {
    // Lock the order for the duration so two concurrent shipments can't
    // over-commit the same line past what was ordered.
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, input.orderId), isNull(orders.deletedAt)))
      .for("update");
    if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
    if (order.status !== "confirmed" && order.status !== "partially_fulfilled") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Only a confirmed order can be shipped (this one is ${order.status}).`,
      });
    }

    const shipFromWarehouseId = input.shipFromWarehouseId ?? order.warehouseId;
    if (!shipFromWarehouseId) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No warehouse to ship from — set one on the order." });
    }
    const [warehouse] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(
        and(eq(warehouses.tenantId, tenantId), eq(warehouses.id, shipFromWarehouseId), isNull(warehouses.deletedAt)),
      );
    if (!warehouse) throw new TRPCError({ code: "NOT_FOUND", message: "Warehouse not found" });

    // validate each requested line against what's still un-shipped
    const resolved: Array<{ orderLine: typeof orderLineItems.$inferSelect; quantity: string }> = [];
    for (const requested of input.lines) {
      const [orderLine] = await tx
        .select()
        .from(orderLineItems)
        .where(
          and(
            eq(orderLineItems.tenantId, tenantId),
            eq(orderLineItems.id, requested.orderLineItemId),
            eq(orderLineItems.orderId, input.orderId),
          ),
        );
      if (!orderLine) throw new TRPCError({ code: "NOT_FOUND", message: "Order line not found on this order" });

      const committed = await committedQuantityMilli(tx, tenantId, orderLine.id);
      const remaining = toMilliUnits(orderLine.quantity) - committed;
      const wanted = toMilliUnits(requested.quantity.toFixed(3));
      if (wanted > remaining) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Only ${fromMilliUnits(remaining)} of "${orderLine.description}" left to ship.`,
        });
      }
      resolved.push({ orderLine, quantity: requested.quantity.toFixed(3) });
    }

    const carrier = input.carrier ?? null;
    const [shipment] = await tx
      .insert(shipments)
      .values({
        tenantId,
        orderId: input.orderId,
        shipFromWarehouseId,
        carrier,
        service: input.service ?? null,
        trackingNumber: input.trackingNumber ?? null,
        trackingUrl: resolveTrackingUrl(carrier, input.trackingNumber, null),
        shipToAddress: order.shippingAddress ?? null,
        packageCount: input.packageCount ?? 1,
        weightGrams: input.weightGrams ?? null,
        notes: input.notes ?? null,
        createdByUserId: isSystemActor(actor) ? null : actor.userId,
      })
      .returning();

    const lineItems: ShipmentLineItem[] = [];
    for (const { orderLine, quantity } of resolved) {
      const [row] = await tx
        .insert(shipmentLineItems)
        .values({
          tenantId,
          shipmentId: shipment.id,
          orderLineItemId: orderLine.id,
          productId: orderLine.productId,
          description: orderLine.description,
          unitCost: orderLine.unitCost,
          quantity,
        })
        .returning();
      lineItems.push(row);
    }

    return { shipment, lineItems };
  });
}

export const updateShipmentInput = z.object({
  id: z.string().uuid(),
  carrier: z.enum(carrierEnum.enumValues).nullish(),
  service: z.string().trim().max(120).nullish(),
  trackingNumber: z.string().trim().max(120).nullish(),
  trackingUrl: z.string().trim().url().max(500).nullish(),
  packageCount: z.number().int().min(1).max(1000).optional(),
  weightGrams: z.number().int().min(0).max(100_000_000).nullish(),
  shippingCost: z.number().nonnegative().multipleOf(0.01).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export async function updateShipment(
  actor: ActorContext,
  rawInput: z.input<typeof updateShipmentInput>,
): Promise<Shipment> {
  const input = updateShipmentInput.parse(rawInput);
  return withTenantContext(actor.tenantId, async (tx) => {
    const shipment = await requireShipment(tx, actor.tenantId, input.id);
    if (!EDITABLE_STATUSES.includes(shipment.status)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `A ${shipment.status} shipment can't be edited.`,
      });
    }

    const carrier = input.carrier !== undefined ? input.carrier : shipment.carrier;
    const trackingNumber = input.trackingNumber !== undefined ? input.trackingNumber : shipment.trackingNumber;
    const trackingUrl =
      input.trackingUrl !== undefined
        ? input.trackingUrl
        : resolveTrackingUrl(carrier as Carrier | null, trackingNumber, null);

    const [row] = await tx
      .update(shipments)
      .set({
        ...(input.carrier !== undefined ? { carrier: input.carrier } : {}),
        ...(input.service !== undefined ? { service: input.service } : {}),
        ...(input.trackingNumber !== undefined ? { trackingNumber: input.trackingNumber } : {}),
        trackingUrl,
        ...(input.packageCount !== undefined ? { packageCount: input.packageCount } : {}),
        ...(input.weightGrams !== undefined ? { weightGrams: input.weightGrams } : {}),
        ...(input.shippingCost !== undefined
          ? { shippingCost: input.shippingCost === null ? null : input.shippingCost.toFixed(2) }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(shipments.tenantId, actor.tenantId), eq(shipments.id, input.id)))
      .returning();
    return row;
  });
}

export async function cancelShipment(actor: ActorContext, id: string): Promise<Shipment> {
  return withTenantContext(actor.tenantId, async (tx) => {
    const shipment = await requireShipment(tx, actor.tenantId, id);
    if (!EDITABLE_STATUSES.includes(shipment.status)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `A ${shipment.status} shipment can't be cancelled — use the "exception" status instead.`,
      });
    }
    const [row] = await tx
      .update(shipments)
      .set({ status: "cancelled", deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(shipments.tenantId, actor.tenantId), eq(shipments.id, id)))
      .returning();
    return row;
  });
}

// ---------------------------------------------------------------------------
// state machine

export const transitionShipmentInput = z.object({
  id: z.string().uuid(),
  status: z.enum(shipmentStatusEnum.enumValues),
});

export async function transitionShipment(
  actor: ActorContext,
  rawInput: z.input<typeof transitionShipmentInput>,
): Promise<Shipment> {
  const input = transitionShipmentInput.parse(rawInput);
  const { tenantId } = actor;
  return withTenantContext(tenantId, async (tx) => {
    const shipment = await requireShipment(tx, tenantId, input.id, true);
    if (shipment.status === input.status) return shipment;
    if (!ALLOWED_TRANSITIONS[shipment.status].includes(input.status)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `A shipment can't move from ${shipment.status} to ${input.status}.`,
      });
    }

    const now = new Date();
    const patch: Partial<typeof shipments.$inferInsert> = { status: input.status, updatedAt: now };

    if (input.status === "shipped" && shipment.stockAppliedAt === null) {
      const [order] = await tx
        .select({ warehouseId: orders.warehouseId })
        .from(orders)
        .where(and(eq(orders.tenantId, tenantId), eq(orders.id, shipment.orderId)));

      const lines = await tx
        .select({ sli: shipmentLineItems, product: products })
        .from(shipmentLineItems)
        .leftJoin(products, eq(shipmentLineItems.productId, products.id))
        .where(and(eq(shipmentLineItems.tenantId, tenantId), eq(shipmentLineItems.shipmentId, shipment.id)));

      for (const { sli, product } of lines) {
        if (product?.tracksInventory) {
          await recordSale(tx, tenantId, {
            productId: sli.productId!,
            saleWarehouseId: shipment.shipFromWarehouseId,
            reservationWarehouseId: order?.warehouseId ?? null,
            quantity: sli.quantity,
            unitCost: sli.unitCost,
            orderId: shipment.orderId,
            shipmentId: shipment.id,
            actorUserId: isSystemActor(actor) ? null : actor.userId,
          });
        }
        await tx
          .update(orderLineItems)
          .set({ quantityShipped: sql`${orderLineItems.quantityShipped} + ${sli.quantity}` })
          .where(and(eq(orderLineItems.tenantId, tenantId), eq(orderLineItems.id, sli.orderLineItemId)));
      }

      const period = now.getUTCFullYear();
      const seq = await allocateSequence(tx, tenantId, "delivery_note", period);
      const settings = await readSettings(tx, tenantId);
      patch.number = formatDocumentNumber(settings.deliveryNoteNumberFormat, period, seq);
      patch.stockAppliedAt = now;
      patch.shippedAt = now;

      await recomputeFulfillment(tx, tenantId, shipment.orderId);
      await recordAudit(tx, tenantId, actor, {
        entityType: "shipment",
        entityId: shipment.id,
        action: "shipment.ship",
        summary: `Dispatched ${patch.number} for order ${shipment.orderId}`,
      });
    }

    if (input.status === "delivered") patch.deliveredAt = now;

    const [row] = await tx
      .update(shipments)
      .set(patch)
      .where(and(eq(shipments.tenantId, tenantId), eq(shipments.id, input.id)))
      .returning();
    return row;
  });
}

// ---------------------------------------------------------------------------
// reads

export const listShipmentsInput = z
  .object({
    orderId: z.string().uuid().optional(),
    status: z.enum(shipmentStatusEnum.enumValues).optional(),
    page: z.number().int().min(1).default(1),
  })
  .optional();

export function listShipments(tenantId: string, rawInput?: z.input<typeof listShipmentsInput>) {
  const input = listShipmentsInput.parse(rawInput);
  const page = input?.page ?? 1;
  return withTenantContext(tenantId, (tx) =>
    tx
      .select({
        id: shipments.id,
        number: shipments.number,
        status: shipments.status,
        orderId: shipments.orderId,
        orderNumber: orders.number,
        carrier: shipments.carrier,
        trackingNumber: shipments.trackingNumber,
        shippedAt: shipments.shippedAt,
        createdAt: shipments.createdAt,
      })
      .from(shipments)
      .innerJoin(orders, eq(shipments.orderId, orders.id))
      .where(
        and(
          eq(shipments.tenantId, tenantId),
          isNull(shipments.deletedAt),
          input?.orderId ? eq(shipments.orderId, input.orderId) : undefined,
          input?.status ? eq(shipments.status, input.status) : undefined,
        ),
      )
      .orderBy(desc(shipments.createdAt))
      .limit(SHIPMENT_PAGE_SIZE)
      .offset((page - 1) * SHIPMENT_PAGE_SIZE),
  );
}

export async function getShipmentWithLines(tenantId: string, id: string) {
  return withTenantContext(tenantId, async (tx) => {
    const shipment = await requireShipment(tx, tenantId, id);
    const lineItems = await tx
      .select()
      .from(shipmentLineItems)
      .where(and(eq(shipmentLineItems.tenantId, tenantId), eq(shipmentLineItems.shipmentId, id)));
    return { shipment, lineItems };
  });
}

/** Per-line ordered / shipped / remaining plus the order's shipments. */
export async function getOrderFulfillment(tenantId: string, orderId: string) {
  return withTenantContext(tenantId, async (tx) => {
    const [order] = await tx
      .select({ id: orders.id, status: orders.status, fulfillmentStatus: orders.fulfillmentStatus })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId), isNull(orders.deletedAt)));
    if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });

    const lineRows = await tx
      .select()
      .from(orderLineItems)
      .where(and(eq(orderLineItems.tenantId, tenantId), eq(orderLineItems.orderId, orderId)))
      .orderBy(asc(orderLineItems.createdAt));

    const lines = await Promise.all(
      lineRows.map(async (line) => {
        const committed = await committedQuantityMilli(tx, tenantId, line.id);
        return {
          orderLineItemId: line.id,
          description: line.description,
          ordered: line.quantity,
          shipped: line.quantityShipped,
          committed: fromMilliUnits(committed),
          remaining: fromMilliUnits(toMilliUnits(line.quantity) - committed),
          backordered: line.backordered,
        };
      }),
    );

    const shipmentRows = await tx
      .select({
        id: shipments.id,
        number: shipments.number,
        status: shipments.status,
        carrier: shipments.carrier,
        trackingNumber: shipments.trackingNumber,
        trackingUrl: shipments.trackingUrl,
        shippedAt: shipments.shippedAt,
      })
      .from(shipments)
      .where(and(eq(shipments.tenantId, tenantId), eq(shipments.orderId, orderId), isNull(shipments.deletedAt)))
      .orderBy(desc(shipments.createdAt));

    return { order, lines, shipments: shipmentRows };
  });
}
