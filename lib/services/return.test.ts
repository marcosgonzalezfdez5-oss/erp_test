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
import * as accountService from "./account";
import * as pipelineService from "./pipeline";
import * as productService from "./product";
import * as warehouseService from "./warehouse";
import * as tenantSettingsService from "./tenant-settings";
import * as inventoryService from "./inventory";
import * as orderService from "./order";
import * as shipmentService from "./shipment";
import * as invoiceService from "./invoice";
import * as returnService from "./return";

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

/** Confirmed order (qty 10, cost 6), 8 units shipped, invoice for the full order issued. */
async function scenario(label: string, opts: { invoice?: boolean } = {}) {
  const actor = await createActor(label);
  const account = await accountService.createAccount(actor.tenantId, { name: "Acme SL" });
  const warehouse = await warehouseService.createWarehouse(actor, { name: "Madrid", code: "MAD" });
  await tenantSettingsService.updateSettings(actor, { legalName: "Vendor SA", taxId: "B12345678" });
  const product = await productService.createProduct(actor.tenantId, {
    name: "Widget",
    unitPrice: 10,
    costPrice: 6,
    taxRatePercent: 0,
  });
  await inventoryService.receiveStock(actor, { productId: product.id, warehouseId: warehouse.id, quantity: 100 });

  const order = await orderService.createOrder(actor.tenantId, {
    accountId: account.id,
    lines: [{ productId: product.id, quantity: 10 }],
  });
  await orderService.confirmOrder(actor, { id: order.id, warehouseId: warehouse.id });
  const { lineItems } = await orderService.getOrderWithLineItems(actor.tenantId, order.id);

  const { shipment } = await shipmentService.createShipment(actor, {
    orderId: order.id,
    lines: [{ orderLineItemId: lineItems[0].id, quantity: 8 }],
  });
  await shipmentService.transitionShipment(actor, { id: shipment.id, status: "shipped" });
  const { lineItems: shipLines } = await shipmentService.getShipmentWithLines(actor.tenantId, shipment.id);

  let invoice = null;
  if (opts.invoice !== false) {
    const draft = await invoiceService.createInvoiceFromOrder(actor, { orderId: order.id });
    invoice = await invoiceService.issueInvoice(actor, { id: draft.id });
  }

  return { actor, account, warehouse, product, order, orderLine: lineItems[0], shipment, shipLine: shipLines[0], invoice };
}

function movementsFor(tenantId: string, productId: string) {
  return withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.productId, productId))),
  );
}

describe("return — restock + credit note", () => {
  it("restocks at original cost, walks back the shipped quantity, and raises a linked credit note", async () => {
    const { actor, product, order, shipment, shipLine, invoice } = await scenario("a");
    const year = new Date().getUTCFullYear();

    const { creditNote, restocked } = await returnService.recordReturn(actor, {
      shipmentId: shipment.id,
      lines: [{ shipmentLineItemId: shipLine.id, quantity: 3 }],
      rectificationReason: "R1",
    });

    expect(restocked).toEqual([{ productId: product.id, quantity: "3.000" }]);
    expect(creditNote?.number).toBe(`REC-${year}-0001`);
    expect(creditNote?.rectifiesInvoiceId).toBe(invoice!.id);
    expect(creditNote?.subtotalAmount).toBe("30.00");

    const moves = await movementsFor(actor.tenantId, product.id);
    const ret = moves.find((m) => m.reason === "return")!;
    expect(ret).toMatchObject({ quantityDelta: "3.000", unitCost: "6.00" });

    const { lineItems } = await orderService.getOrderWithLineItems(actor.tenantId, order.id);
    expect(lineItems[0].quantityShipped).toBe("5.000"); // 8 shipped − 3 returned

    const fulfil = await shipmentService.getOrderFulfillment(actor.tenantId, order.id);
    expect(fulfil.order.fulfillmentStatus).toBe("partially_fulfilled");

    // credit note reversed the invoiced quantity 10 → 7
    const refreshedOrder = await orderService.getOrder(actor.tenantId, order.id);
    expect(refreshedOrder.invoiceStatus).toBe("partially_invoiced");
  });

  it("can restock without a credit note", async () => {
    const { actor, product, shipment, shipLine } = await scenario("a", { invoice: false });

    const { creditNote } = await returnService.recordReturn(actor, {
      shipmentId: shipment.id,
      lines: [{ shipmentLineItemId: shipLine.id, quantity: 2 }],
      createCreditNote: false,
    });
    expect(creditNote).toBeNull();

    const [level] = await inventoryService.getStockLevels(actor.tenantId, { productId: product.id });
    expect(level.quantityOnHand).toBe("94.000"); // 100 − 8 sold + 2 returned
  });

  it("won't return more than is currently shipped", async () => {
    const { actor, shipment, shipLine } = await scenario("a", { invoice: false });
    await expect(
      returnService.recordReturn(actor, {
        shipmentId: shipment.id,
        lines: [{ shipmentLineItemId: shipLine.id, quantity: 9 }],
        createCreditNote: false,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("won't raise a credit note when the order has no issued invoice", async () => {
    const { actor, shipment, shipLine } = await scenario("a", { invoice: false });
    await expect(
      returnService.recordReturn(actor, {
        shipmentId: shipment.id,
        lines: [{ shipmentLineItemId: shipLine.id, quantity: 2 }],
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("is manager-gated", async () => {
    const { actor, shipment, shipLine } = await scenario("a", { invoice: false });
    await expect(
      returnService.recordReturn(
        { ...actor, role: "sales_rep" },
        { shipmentId: shipment.id, lines: [{ shipmentLineItemId: shipLine.id, quantity: 1 }], createCreditNote: false },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("return — tenant isolation", () => {
  it("cannot record a return against another tenant's shipment", async () => {
    const { shipment, shipLine } = await scenario("a", { invoice: false });
    const { actor: b } = await scenario("b", { invoice: false });

    await expect(
      returnService.recordReturn(b, {
        shipmentId: shipment.id,
        lines: [{ shipmentLineItemId: shipLine.id, quantity: 1 }],
        createCreditNote: false,
      }),
    ).rejects.toThrow(TRPCError);
  });
});
