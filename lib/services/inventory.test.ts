import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import { users } from "@/lib/db/schema/user";
import { auditLogEntries } from "@/lib/db/schema/audit-log";
import { ON_HAND_REASONS, stockMovements } from "@/lib/db/schema/inventory";
import { withTenantContext } from "@/lib/db/tenant-context";
import { fromMilliUnits, toMilliUnits } from "@/lib/money";
import type { ActorContext } from "@/lib/auth/actor";
import type { MembershipRole } from "@/lib/db/schema/membership";
import * as pipelineService from "./pipeline";
import * as productService from "./product";
import * as warehouseService from "./warehouse";
import * as tenantSettingsService from "./tenant-settings";
import * as orderService from "./order";
import * as inventoryService from "./inventory";

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

async function stockScenario(label: string) {
  const actor = await createActor(label);
  const warehouse = await warehouseService.createWarehouse(actor, { name: "Madrid", code: "MAD" });
  const product = await productService.createProduct(actor.tenantId, {
    name: "Widget",
    unitPrice: 10,
    costPrice: 6,
    taxRatePercent: 0,
    reorderPoint: 5,
  });
  return { actor, warehouse, product };
}

function levelFor(levels: Awaited<ReturnType<typeof inventoryService.getStockLevels>>, productId: string, warehouseId: string) {
  return levels.find((l) => l.productId === productId && l.warehouseId === warehouseId)!;
}

describe("inventory — manual operations", () => {
  it("receives stock, snapshotting the product cost onto the movement", async () => {
    const { actor, warehouse, product } = await stockScenario("a");

    await inventoryService.receiveStock(actor, { productId: product.id, warehouseId: warehouse.id, quantity: 100 });

    const [level] = await inventoryService.getStockLevels(actor.tenantId, { productId: product.id });
    expect(level.quantityOnHand).toBe("100.000");
    expect(level.quantityAvailable).toBe("100.000");

    const [movement] = await inventoryService.listMovements(actor.tenantId, { productId: product.id });
    expect(movement).toMatchObject({ reason: "receipt", quantityDelta: "100.000", unitCost: "6.00" });

    // later cost change does not rewrite the historical movement
    await productService.updateProduct(actor.tenantId, { id: product.id, name: "Widget", unitPrice: 10, costPrice: 9 });
    await inventoryService.receiveStock(actor, { productId: product.id, warehouseId: warehouse.id, quantity: 1 });
    const movements = await inventoryService.listMovements(actor.tenantId, { productId: product.id });
    expect(movements.map((m) => m.unitCost)).toEqual(["9.00", "6.00"]);
  });

  it("adjusts on-hand to an absolute value and writes an audit entry", async () => {
    const { actor, warehouse, product } = await stockScenario("a");
    await inventoryService.receiveStock(actor, { productId: product.id, warehouseId: warehouse.id, quantity: 10 });

    await inventoryService.adjustStock(actor, {
      productId: product.id,
      warehouseId: warehouse.id,
      newOnHand: 7,
      note: "annual count",
    });

    const [level] = await inventoryService.getStockLevels(actor.tenantId, { productId: product.id });
    expect(level.quantityOnHand).toBe("7.000");

    const audit = await withTenantContext(actor.tenantId, (tx) =>
      tx.select().from(auditLogEntries).where(and(eq(auditLogEntries.tenantId, actor.tenantId), eq(auditLogEntries.action, "stock.adjust"))),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].diff).toEqual({ quantityOnHand: { from: "10.000", to: "7.000" } });
  });

  it("transfers stock between warehouses, conserving the total", async () => {
    const { actor, warehouse: mad, product } = await stockScenario("a");
    const vlc = await warehouseService.createWarehouse(actor, { name: "Valencia", code: "VLC" });
    await inventoryService.receiveStock(actor, { productId: product.id, warehouseId: mad.id, quantity: 10 });

    await inventoryService.transferStock(actor, {
      productId: product.id,
      fromWarehouseId: mad.id,
      toWarehouseId: vlc.id,
      quantity: 3,
    });

    const levels = await inventoryService.getStockLevels(actor.tenantId, { productId: product.id });
    expect(levelFor(levels, product.id, mad.id).quantityOnHand).toBe("7.000");
    expect(levelFor(levels, product.id, vlc.id).quantityOnHand).toBe("3.000");
  });

  it("rejects a transfer larger than what's on hand, and a same-warehouse transfer", async () => {
    const { actor, warehouse: mad, product } = await stockScenario("a");
    const vlc = await warehouseService.createWarehouse(actor, { name: "Valencia", code: "VLC" });
    await inventoryService.receiveStock(actor, { productId: product.id, warehouseId: mad.id, quantity: 2 });

    await expect(
      inventoryService.transferStock(actor, { productId: product.id, fromWarehouseId: mad.id, toWarehouseId: vlc.id, quantity: 5 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      inventoryService.transferStock(actor, { productId: product.id, fromWarehouseId: mad.id, toWarehouseId: mad.id, quantity: 1 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses to receive into a product that isn't stock-tracked", async () => {
    const { actor, warehouse } = await stockScenario("a");
    const service = await productService.createProduct(actor.tenantId, {
      name: "Install fee",
      unitPrice: 50,
      tracksInventory: false,
    });
    await expect(
      inventoryService.receiveStock(actor, { productId: service.id, warehouseId: warehouse.id, quantity: 1 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("requires a manager role for every manual operation", async () => {
    const { actor, warehouse, product } = await stockScenario("a");
    const rep = { ...actor, role: "sales_rep" as const };
    for (const call of [
      () => inventoryService.receiveStock(rep, { productId: product.id, warehouseId: warehouse.id, quantity: 1 }),
      () => inventoryService.adjustStock(rep, { productId: product.id, warehouseId: warehouse.id, newOnHand: 1, note: "x" }),
      () =>
        inventoryService.transferStock(rep, {
          productId: product.id,
          fromWarehouseId: warehouse.id,
          toWarehouseId: warehouse.id,
          quantity: 1,
        }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});

describe("inventory — ledger invariant", () => {
  it("keeps stock levels equal to the summed movement deltas", async () => {
    const { actor, warehouse: mad, product } = await stockScenario("a");
    const vlc = await warehouseService.createWarehouse(actor, { name: "Valencia", code: "VLC" });

    await inventoryService.receiveStock(actor, { productId: product.id, warehouseId: mad.id, quantity: 10 });
    await inventoryService.adjustStock(actor, { productId: product.id, warehouseId: mad.id, newOnHand: 7, note: "count" });
    const order = await orderService.createOrder(actor.tenantId, { lines: [{ productId: product.id, quantity: 2 }] });
    await orderService.confirmOrder(actor, { id: order.id, warehouseId: mad.id });
    await inventoryService.transferStock(actor, {
      productId: product.id,
      fromWarehouseId: mad.id,
      toWarehouseId: vlc.id,
      quantity: 3,
    });
    await orderService.cancelOrder(actor, { id: order.id });

    const levels = await inventoryService.getStockLevels(actor.tenantId, { productId: product.id });

    // recompute expected on-hand / reserved per warehouse straight from the ledger
    const ledger = await withTenantContext(actor.tenantId, (tx) =>
      tx
        .select()
        .from(stockMovements)
        .where(and(eq(stockMovements.tenantId, actor.tenantId), eq(stockMovements.productId, product.id))),
    );
    const byWarehouse = new Map<string, { onHand: bigint; reserved: bigint }>();
    for (const m of ledger) {
      const bucket = byWarehouse.get(m.warehouseId) ?? { onHand: 0n, reserved: 0n };
      const delta = toMilliUnits(m.quantityDelta);
      if ((ON_HAND_REASONS as readonly string[]).includes(m.reason)) bucket.onHand += delta;
      else bucket.reserved += delta;
      byWarehouse.set(m.warehouseId, bucket);
    }

    for (const [warehouseId, expected] of byWarehouse) {
      const level = levelFor(levels, product.id, warehouseId);
      expect(level.quantityOnHand).toBe(fromMilliUnits(expected.onHand));
      expect(level.quantityReserved).toBe(fromMilliUnits(expected.reserved));
    }
    expect(levelFor(levels, product.id, mad.id)).toMatchObject({ quantityOnHand: "4.000", quantityReserved: "0.000" });
    expect(levelFor(levels, product.id, vlc.id)).toMatchObject({ quantityOnHand: "3.000" });
  });
});

describe("inventory — order reservation", () => {
  it("reserves stock on confirm and releases it on cancel", async () => {
    const { actor, warehouse, product } = await stockScenario("a");
    await inventoryService.receiveStock(actor, { productId: product.id, warehouseId: warehouse.id, quantity: 100 });

    const order = await orderService.createOrder(actor.tenantId, { lines: [{ productId: product.id, quantity: 3 }] });
    await orderService.confirmOrder(actor, { id: order.id, warehouseId: warehouse.id });

    let level = (await inventoryService.getStockLevels(actor.tenantId, { productId: product.id }))[0];
    expect(level).toMatchObject({ quantityOnHand: "100.000", quantityReserved: "3.000", quantityAvailable: "97.000" });

    await orderService.cancelOrder(actor, { id: order.id });
    level = (await inventoryService.getStockLevels(actor.tenantId, { productId: product.id }))[0];
    expect(level).toMatchObject({ quantityReserved: "0.000", quantityAvailable: "100.000" });
  });

  it("flags a line backordered when short and negative stock is allowed", async () => {
    const { actor, warehouse, product } = await stockScenario("a");
    await inventoryService.receiveStock(actor, { productId: product.id, warehouseId: warehouse.id, quantity: 2 });

    const order = await orderService.createOrder(actor.tenantId, { lines: [{ productId: product.id, quantity: 5 }] });
    await orderService.confirmOrder(actor, { id: order.id, warehouseId: warehouse.id });

    const { lineItems } = await orderService.getOrderWithLineItems(actor.tenantId, order.id);
    expect(lineItems[0].backordered).toBe(true);
    const [level] = await inventoryService.getStockLevels(actor.tenantId, { productId: product.id });
    expect(level).toMatchObject({ quantityReserved: "5.000", quantityAvailable: "-3.000" });
  });

  it("blocks confirmation and reserves nothing when short and negative stock is disallowed", async () => {
    const { actor, warehouse, product } = await stockScenario("a");
    await tenantSettingsService.updateSettings(actor, { allowNegativeStock: false });
    await inventoryService.receiveStock(actor, { productId: product.id, warehouseId: warehouse.id, quantity: 2 });

    const order = await orderService.createOrder(actor.tenantId, { lines: [{ productId: product.id, quantity: 5 }] });
    await expect(orderService.confirmOrder(actor, { id: order.id, warehouseId: warehouse.id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });

    expect((await orderService.getOrder(actor.tenantId, order.id)).status).toBe("draft");
    const [level] = await inventoryService.getStockLevels(actor.tenantId, { productId: product.id });
    expect(level.quantityReserved).toBe("0.000");
  });

  it("cannot oversell under concurrent confirmations", async () => {
    const { actor, warehouse, product } = await stockScenario("a");
    await tenantSettingsService.updateSettings(actor, { allowNegativeStock: false });
    await inventoryService.receiveStock(actor, { productId: product.id, warehouseId: warehouse.id, quantity: 1 });

    const o1 = await orderService.createOrder(actor.tenantId, { lines: [{ productId: product.id, quantity: 1 }] });
    const o2 = await orderService.createOrder(actor.tenantId, { lines: [{ productId: product.id, quantity: 1 }] });

    const results = await Promise.allSettled([
      orderService.confirmOrder(actor, { id: o1.id, warehouseId: warehouse.id }),
      orderService.confirmOrder(actor, { id: o2.id, warehouseId: warehouse.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const [level] = await inventoryService.getStockLevels(actor.tenantId, { productId: product.id });
    expect(level).toMatchObject({ quantityOnHand: "1.000", quantityReserved: "1.000" });
  });

  it("skips reservation for a product that isn't stock-tracked", async () => {
    const { actor, warehouse } = await stockScenario("a");
    const service = await productService.createProduct(actor.tenantId, {
      name: "Consulting",
      unitPrice: 500,
      tracksInventory: false,
    });
    const order = await orderService.createOrder(actor.tenantId, { lines: [{ productId: service.id, quantity: 2 }] });
    await orderService.confirmOrder(actor, { id: order.id, warehouseId: warehouse.id });

    expect(await inventoryService.getStockLevels(actor.tenantId, { productId: service.id })).toHaveLength(0);
  });
});

describe("inventory — reads and tenant isolation", () => {
  it("computes availability and the low-stock flag", async () => {
    const { actor, warehouse, product } = await stockScenario("a"); // reorderPoint 5
    await inventoryService.receiveStock(actor, { productId: product.id, warehouseId: warehouse.id, quantity: 4 });

    const [level] = await inventoryService.getStockLevels(actor.tenantId, {});
    expect(level).toMatchObject({ quantityAvailable: "4.000", lowStock: true });
    expect(await inventoryService.getStockLevels(actor.tenantId, { lowStockOnly: true })).toHaveLength(1);

    await inventoryService.receiveStock(actor, { productId: product.id, warehouseId: warehouse.id, quantity: 10 });
    expect(await inventoryService.getStockLevels(actor.tenantId, { lowStockOnly: true })).toHaveLength(0);
  });

  it("scopes levels, movements and every mutation to the tenant", async () => {
    const { actor: a, warehouse: whA, product: prodA } = await stockScenario("a");
    const { actor: b } = await stockScenario("b");
    await inventoryService.receiveStock(a, { productId: prodA.id, warehouseId: whA.id, quantity: 10 });

    expect(await inventoryService.getStockLevels(b.tenantId, {})).toHaveLength(0);
    expect(await inventoryService.listMovements(b.tenantId, {})).toHaveLength(0);
    await expect(
      inventoryService.receiveStock(b, { productId: prodA.id, warehouseId: whA.id, quantity: 1 }),
    ).rejects.toThrow(TRPCError);
    await expect(
      inventoryService.adjustStock(b, { productId: prodA.id, warehouseId: whA.id, newOnHand: 0, note: "x" }),
    ).rejects.toThrow(TRPCError);
  });
});
