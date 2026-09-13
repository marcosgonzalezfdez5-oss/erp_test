import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import { users } from "@/lib/db/schema/user";
import { stockMovements } from "@/lib/db/schema/inventory";
import { withTenantContext } from "@/lib/db/tenant-context";
import type { ActorContext } from "@/lib/auth/actor";
import type { MembershipRole } from "@/lib/db/schema/membership";
import * as pipelineService from "./pipeline";
import * as productService from "./product";
import * as warehouseService from "./warehouse";
import * as inventoryService from "./inventory";
import * as orderService from "./order";
import * as shipmentService from "./shipment";

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

afterEach(async () => {
  for (const tenantId of createdTenantIds.splice(0)) {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  }
  for (const userId of createdUserIds.splice(0)) {
    await db.delete(users).where(eq(users.id, userId));
  }
});

async function createActor(label: string, role: MembershipRole = "admin"): Promise<ActorContext> {
  const [tenant] = await db
    .insert(tenants)
    .values({ clerkOrgId: `org_${label}_${crypto.randomUUID()}`, name: `Tenant ${label}` })
    .returning();
  createdTenantIds.push(tenant.id);
  await pipelineService.seedDefaultPipeline(tenant.id);
  const [user] = await db
    .insert(users)
    .values({ clerkUserId: `user_${label}_${crypto.randomUUID()}`, email: `${label}@example.com` })
    .returning();
  createdUserIds.push(user.id);
  return { tenantId: tenant.id, userId: user.id, role };
}

async function scenario(
  label: string,
  opts: { onHand?: number; qty?: number; tracks?: boolean } = {},
) {
  const actor = await createActor(label);
  const warehouse = await warehouseService.createWarehouse(actor, { name: "Madrid", code: "MAD" });
  const product = await productService.createProduct(actor.tenantId, {
    name: "Widget",
    unitPrice: 10,
    costPrice: 6,
    taxRatePercent: 0,
    tracksInventory: opts.tracks ?? true,
  });
  if ((opts.onHand ?? 0) > 0) {
    await inventoryService.receiveStock(actor, {
      productId: product.id,
      warehouseId: warehouse.id,
      quantity: opts.onHand!,
    });
  }
  const order = await orderService.createOrder(actor.tenantId, {
    lines: [{ productId: product.id, quantity: opts.qty ?? 10 }],
  });
  await orderService.confirmOrder(actor, { id: order.id, warehouseId: warehouse.id });
  const { lineItems } = await orderService.getOrderWithLineItems(actor.tenantId, order.id);
  return { actor, warehouse, product, order, orderLine: lineItems[0] };
}

function movementsFor(tenantId: string, productId: string) {
  return withTenantContext(tenantId, (tx) =>
    tx.select().from(stockMovements).where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.productId, productId))),
  );
}

describe("shipment — creation", () => {
  it("creates a draft shipment snapshotting the order line, with no DN number yet", async () => {
    const { actor, order, orderLine } = await scenario("a", { onHand: 100 });

    const { shipment, lineItems } = await shipmentService.createShipment(actor, {
      orderId: order.id,
      lines: [{ orderLineItemId: orderLine.id, quantity: 6 }],
      carrier: "seur",
      trackingNumber: "ABC123",
    });

    expect(shipment.status).toBe("draft");
    expect(shipment.number).toBeNull();
    expect(shipment.trackingUrl).toContain("ABC123");
    expect(lineItems[0]).toMatchObject({ description: "Widget", unitCost: "6.00", quantity: "6.000" });
  });

  it("won't ship more than the un-shipped remainder of a line", async () => {
    const { actor, order, orderLine } = await scenario("a", { onHand: 100, qty: 10 });
    await shipmentService.createShipment(actor, { orderId: order.id, lines: [{ orderLineItemId: orderLine.id, quantity: 7 }] });

    await expect(
      shipmentService.createShipment(actor, { orderId: order.id, lines: [{ orderLineItemId: orderLine.id, quantity: 5 }] }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("refuses to ship a draft (unconfirmed) order", async () => {
    const actor = await createActor("a");
    await warehouseService.createWarehouse(actor, { name: "Madrid", code: "MAD" });
    const product = await productService.createProduct(actor.tenantId, { name: "Widget", unitPrice: 10 });
    const order = await orderService.createOrder(actor.tenantId, { lines: [{ productId: product.id, quantity: 1 }] });
    const { lineItems } = await orderService.getOrderWithLineItems(actor.tenantId, order.id);

    await expect(
      shipmentService.createShipment(actor, { orderId: order.id, lines: [{ orderLineItemId: lineItems[0].id, quantity: 1 }] }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("shipment — the shipped transition", () => {
  it("draws down stock, releases the reservation, assigns a DN number, and advances fulfilment", async () => {
    const { actor, order, orderLine } = await scenario("a", { onHand: 100, qty: 10 });
    const year = new Date().getUTCFullYear();

    const { shipment } = await shipmentService.createShipment(actor, {
      orderId: order.id,
      lines: [{ orderLineItemId: orderLine.id, quantity: 6 }],
    });
    const shipped = await shipmentService.transitionShipment(actor, { id: shipment.id, status: "shipped" });

    expect(shipped.number).toBe(`DN-${year}-0001`);
    expect(shipped.shippedAt).not.toBeNull();

    const [level] = await inventoryService.getStockLevels(actor.tenantId, { productId: orderLine.productId! });
    expect(level).toMatchObject({ quantityOnHand: "94.000", quantityReserved: "4.000", quantityAvailable: "90.000" });

    const fulfil = await shipmentService.getOrderFulfillment(actor.tenantId, order.id);
    expect(fulfil.order.fulfillmentStatus).toBe("partially_fulfilled");
    expect(fulfil.order.status).toBe("partially_fulfilled");
    expect(fulfil.lines[0]).toMatchObject({ shipped: "6.000", remaining: "4.000" });

    // exactly one sale + one reservation_release for the 6 units
    const moves = await movementsFor(actor.tenantId, orderLine.productId!);
    expect(moves.filter((m) => m.reason === "sale").map((m) => m.quantityDelta)).toEqual(["-6.000"]);
    expect(moves.filter((m) => m.reason === "reservation_release").map((m) => m.quantityDelta)).toEqual(["-6.000"]);
  });

  it("marks the order fulfilled once every line is fully shipped", async () => {
    const { actor, order, orderLine } = await scenario("a", { onHand: 100, qty: 10 });

    for (const quantity of [6, 4]) {
      const { shipment } = await shipmentService.createShipment(actor, {
        orderId: order.id,
        lines: [{ orderLineItemId: orderLine.id, quantity }],
      });
      await shipmentService.transitionShipment(actor, { id: shipment.id, status: "shipped" });
    }

    const fulfil = await shipmentService.getOrderFulfillment(actor.tenantId, order.id);
    expect(fulfil.order.fulfillmentStatus).toBe("fulfilled");
    expect(fulfil.order.status).toBe("fulfilled");

    const [level] = await inventoryService.getStockLevels(actor.tenantId, { productId: orderLine.productId! });
    expect(level).toMatchObject({ quantityOnHand: "90.000", quantityReserved: "0.000" });
  });

  it("bumps the shipped quantity but touches no stock for a non-tracked product", async () => {
    const { actor, order, orderLine } = await scenario("a", { tracks: false, qty: 3 });

    const { shipment } = await shipmentService.createShipment(actor, {
      orderId: order.id,
      lines: [{ orderLineItemId: orderLine.id, quantity: 3 }],
    });
    await shipmentService.transitionShipment(actor, { id: shipment.id, status: "shipped" });

    expect(await movementsFor(actor.tenantId, orderLine.productId!)).toHaveLength(0);
    const fulfil = await shipmentService.getOrderFulfillment(actor.tenantId, order.id);
    expect(fulfil.order.fulfillmentStatus).toBe("fulfilled");
  });

  it("enforces the state machine", async () => {
    const { actor, order, orderLine } = await scenario("a", { onHand: 10 });
    const { shipment } = await shipmentService.createShipment(actor, {
      orderId: order.id,
      lines: [{ orderLineItemId: orderLine.id, quantity: 10 }],
    });

    await shipmentService.transitionShipment(actor, { id: shipment.id, status: "shipped" });
    // can't go backwards
    await expect(
      shipmentService.transitionShipment(actor, { id: shipment.id, status: "picking" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const delivered = await shipmentService.transitionShipment(actor, { id: shipment.id, status: "delivered" });
    expect(delivered.deliveredAt).not.toBeNull();
  });
});

describe("shipment — cancellation", () => {
  it("cancels a pre-ship shipment and frees its committed quantity", async () => {
    const { actor, order, orderLine } = await scenario("a", { onHand: 100, qty: 10 });
    const { shipment } = await shipmentService.createShipment(actor, {
      orderId: order.id,
      lines: [{ orderLineItemId: orderLine.id, quantity: 10 }],
    });

    await shipmentService.cancelShipment(actor, shipment.id);

    // the full 10 is available to ship again
    const fresh = await shipmentService.createShipment(actor, {
      orderId: order.id,
      lines: [{ orderLineItemId: orderLine.id, quantity: 10 }],
    });
    expect(fresh.shipment.status).toBe("draft");
  });

  it("won't cancel a shipped shipment", async () => {
    const { actor, order, orderLine } = await scenario("a", { onHand: 10 });
    const { shipment } = await shipmentService.createShipment(actor, {
      orderId: order.id,
      lines: [{ orderLineItemId: orderLine.id, quantity: 10 }],
    });
    await shipmentService.transitionShipment(actor, { id: shipment.id, status: "shipped" });

    await expect(shipmentService.cancelShipment(actor, shipment.id)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});

describe("shipment — editing and reads", () => {
  it("derives a tracking URL on update and locks editing after shipping", async () => {
    const { actor, order, orderLine } = await scenario("a", { onHand: 10 });
    const { shipment } = await shipmentService.createShipment(actor, {
      orderId: order.id,
      lines: [{ orderLineItemId: orderLine.id, quantity: 10 }],
    });

    const updated = await shipmentService.updateShipment(actor, {
      id: shipment.id,
      carrier: "correos",
      trackingNumber: "PK99",
    });
    expect(updated.trackingUrl).toContain("PK99");

    await shipmentService.transitionShipment(actor, { id: shipment.id, status: "shipped" });
    await expect(
      shipmentService.updateShipment(actor, { id: shipment.id, notes: "too late" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("cannot over-commit a line under concurrent shipment creation", async () => {
    const { actor, order, orderLine } = await scenario("a", { onHand: 100, qty: 10 });

    const results = await Promise.allSettled([
      shipmentService.createShipment(actor, { orderId: order.id, lines: [{ orderLineItemId: orderLine.id, quantity: 6 }] }),
      shipmentService.createShipment(actor, { orderId: order.id, lines: [{ orderLineItemId: orderLine.id, quantity: 6 }] }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const fulfil = await shipmentService.getOrderFulfillment(actor.tenantId, order.id);
    expect(fulfil.lines[0].committed).toBe("6.000");
  });
});

describe("shipment — tenant isolation", () => {
  it("cannot touch another tenant's order or shipment", async () => {
    const { actor: a, order, orderLine } = await scenario("a", { onHand: 100 });
    const { actor: b } = await scenario("b", { onHand: 100 });

    const { shipment } = await shipmentService.createShipment(a, {
      orderId: order.id,
      lines: [{ orderLineItemId: orderLine.id, quantity: 1 }],
    });

    await expect(
      shipmentService.createShipment(b, { orderId: order.id, lines: [{ orderLineItemId: orderLine.id, quantity: 1 }] }),
    ).rejects.toThrow(TRPCError);
    await expect(shipmentService.getShipmentWithLines(b.tenantId, shipment.id)).rejects.toThrow(TRPCError);
    await expect(shipmentService.transitionShipment(b, { id: shipment.id, status: "shipped" })).rejects.toThrow(TRPCError);
    await expect(shipmentService.cancelShipment(b, shipment.id)).rejects.toThrow(TRPCError);
    await expect(shipmentService.getOrderFulfillment(b.tenantId, order.id)).rejects.toThrow(TRPCError);
    expect(await shipmentService.listShipments(b.tenantId)).toHaveLength(0);
  });
});
