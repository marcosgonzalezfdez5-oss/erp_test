import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import { users } from "@/lib/db/schema/user";
import type { ActorContext } from "@/lib/auth/actor";
import * as accountService from "@/lib/services/account";
import * as pipelineService from "@/lib/services/pipeline";
import * as productService from "@/lib/services/product";
import * as warehouseService from "@/lib/services/warehouse";
import * as tenantSettingsService from "@/lib/services/tenant-settings";
import * as orderService from "@/lib/services/order";
import * as shipmentService from "@/lib/services/shipment";
import * as invoiceService from "@/lib/services/invoice";
import { deliveryNoteModel, invoiceDocumentModel } from "./data";
import { renderDocumentPdf } from "./pdf";

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await db.delete(tenants).where(eq(tenants.id, id));
  for (const id of createdUserIds.splice(0)) await db.delete(users).where(eq(users.id, id));
});

async function createActor(label: string): Promise<ActorContext> {
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
  return { tenantId: tenant.id, userId: user.id, role: "admin" };
}

/** A shipped shipment + an issued invoice for a fresh tenant with legal identity set. */
async function scenario(label: string) {
  const actor = await createActor(label);
  await tenantSettingsService.updateSettings(actor, {
    legalName: "Vendedor SA",
    taxId: "B12345678",
    legalAddress: { line1: "C/ Mayor 1", city: "Madrid", postalCode: "28013", country: "ES" },
  });
  const account = await accountService.createAccount(actor.tenantId, { name: "Cliente Acme SL" });
  const warehouse = await warehouseService.createWarehouse(actor, { name: "Madrid", code: "MAD" });
  const product = await productService.createProduct(actor.tenantId, {
    name: "Widget",
    unitPrice: 100,
    taxRatePercent: 21,
    tracksInventory: false,
  });

  const order = await orderService.createOrder(actor.tenantId, {
    accountId: account.id,
    lines: [{ productId: product.id, quantity: 3 }],
  });
  await orderService.confirmOrder(actor, { id: order.id, warehouseId: warehouse.id });
  const { lineItems } = await orderService.getOrderWithLineItems(actor.tenantId, order.id);

  const { shipment } = await shipmentService.createShipment(actor, {
    orderId: order.id,
    shipFromWarehouseId: warehouse.id,
    carrier: "seur",
    trackingNumber: "TRK123",
    lines: [{ orderLineItemId: lineItems[0].id, quantity: 3 }],
  });
  await shipmentService.transitionShipment(actor, { id: shipment.id, status: "shipped" });

  const invoice = await invoiceService.createInvoiceFromOrder(actor, { orderId: order.id });
  const issued = await invoiceService.issueInvoice(actor, { id: invoice.id });

  return { actor, order, warehouse, shipment, invoice: issued };
}

describe("invoiceDocumentModel", () => {
  it("assembles an issued invoice into a renderable model", async () => {
    const { actor, invoice } = await scenario("a");

    const model = await invoiceDocumentModel(actor.tenantId, invoice.id, "invoice");
    expect(model.kind).toBe("invoice");
    expect(model.number).toBe(invoice.number);
    expect(model.seller.name).toBe("Vendedor SA");
    expect(model.seller.taxId).toBe("B12345678");
    expect(model.buyer.name).toBe("Cliente Acme SL");
    expect(model.showAmounts).toBe(true);
    expect(model.lines).toHaveLength(1);
    expect(model.taxGroups).toHaveLength(1);
    const total = model.totals.at(-1)!;
    expect(total.strong).toBe(true);
    expect(total.value).toContain("363,00");

    const pdf = await renderDocumentPdf(model);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("rejects the wrong document type for the id", async () => {
    const { actor, invoice } = await scenario("a");
    await expect(invoiceDocumentModel(actor.tenantId, invoice.id, "credit-note")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("will not read another tenant's invoice", async () => {
    const { invoice } = await scenario("a");
    const b = await createActor("b");
    await expect(invoiceDocumentModel(b.tenantId, invoice.id, "invoice")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("deliveryNoteModel", () => {
  it("assembles a shipped shipment into an amount-free model", async () => {
    const { actor, shipment } = await scenario("a");

    const model = await deliveryNoteModel(actor.tenantId, shipment.id);
    expect(model.kind).toBe("delivery_note");
    expect(model.showAmounts).toBe(false);
    expect(model.title).toBe("Albarán");
    expect(model.number).toMatch(/^DN-/);
    expect(model.buyer.name).toBe("Cliente Acme SL");
    expect(model.lines[0]).toMatchObject({ description: "Widget", quantity: "3.000" });
    expect(model.meta.some((m) => m.value === "TRK123")).toBe(true);

    const pdf = await renderDocumentPdf(model);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("will not read another tenant's shipment", async () => {
    const { shipment } = await scenario("a");
    const b = await createActor("b");
    await expect(deliveryNoteModel(b.tenantId, shipment.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
