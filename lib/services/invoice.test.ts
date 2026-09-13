import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import { users } from "@/lib/db/schema/user";
import { invoices } from "@/lib/db/schema/invoice";
import { withTenantContext } from "@/lib/db/tenant-context";
import type { ActorContext } from "@/lib/auth/actor";
import type { MembershipRole } from "@/lib/db/schema/membership";
import * as accountService from "./account";
import * as pipelineService from "./pipeline";
import * as productService from "./product";
import * as warehouseService from "./warehouse";
import * as tenantSettingsService from "./tenant-settings";
import * as orderService from "./order";
import * as shipmentService from "./shipment";
import * as invoiceService from "./invoice";

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

interface SetupOpts {
  lines?: Array<{ unitPrice: number; taxRatePercent?: number; quantity?: number; subjectToWithholding?: boolean }>;
  legalIdentity?: boolean;
  irpf?: boolean;
}

/** A confirmed order for a fresh tenant, with the seller's legal identity set by default. */
async function setup(label: string, opts: SetupOpts = {}) {
  const actor = await createActor(label);
  const account = await accountService.createAccount(actor.tenantId, { name: "Acme SL" });
  const warehouse = await warehouseService.createWarehouse(actor, { name: "Madrid", code: "MAD" });

  if (opts.legalIdentity !== false) {
    await tenantSettingsService.updateSettings(actor, {
      legalName: "Vendor SA",
      taxId: "B12345678",
      ...(opts.irpf ? { irpfEnabled: true, irpfRatePercent: 15 } : {}),
    });
  } else if (opts.irpf) {
    await tenantSettingsService.updateSettings(actor, { irpfEnabled: true, irpfRatePercent: 15 });
  }

  const lineSpecs = opts.lines ?? [{ unitPrice: 100, taxRatePercent: 21 }];
  const products = await Promise.all(
    lineSpecs.map((l, i) =>
      productService.createProduct(actor.tenantId, {
        name: `P${i}`,
        unitPrice: l.unitPrice,
        taxRatePercent: l.taxRatePercent ?? 21,
        subjectToWithholding: l.subjectToWithholding ?? false,
        tracksInventory: false,
      }),
    ),
  );

  const order = await orderService.createOrder(actor.tenantId, {
    accountId: account.id,
    lines: products.map((p, i) => ({ productId: p.id, quantity: lineSpecs[i].quantity ?? 1 })),
  });
  await orderService.confirmOrder(actor, { id: order.id, warehouseId: warehouse.id });
  const { lineItems } = await orderService.getOrderWithLineItems(actor.tenantId, order.id);
  return { actor, account, warehouse, products, order, orderLines: lineItems };
}

describe("invoice — from an order", () => {
  it("snapshots the un-invoiced lines into a draft with computed totals", async () => {
    const { actor, order } = await setup("a", {
      lines: [
        { unitPrice: 100, taxRatePercent: 21 },
        { unitPrice: 50, taxRatePercent: 10 },
      ],
    });

    const invoice = await invoiceService.createInvoiceFromOrder(actor, { orderId: order.id });
    expect(invoice.status).toBe("draft");
    expect(invoice.number).toBeNull();
    expect(invoice.subtotalAmount).toBe("150.00");
    expect(invoice.taxAmount).toBe("26.00"); // 21 + 5
    expect(invoice.totalAmount).toBe("176.00");
    expect(invoice.taxSummary).toHaveLength(2);
  });

  it("applies IRPF withholding when the tenant has it enabled", async () => {
    const { actor, order } = await setup("a", {
      irpf: true,
      lines: [{ unitPrice: 1000, taxRatePercent: 21, subjectToWithholding: true }],
    });

    const invoice = await invoiceService.createInvoiceFromOrder(actor, { orderId: order.id });
    expect(invoice.subtotalAmount).toBe("1000.00");
    expect(invoice.taxAmount).toBe("210.00");
    expect(invoice.withholdingAmount).toBe("150.00");
    expect(invoice.totalAmount).toBe("1060.00");
  });
});

describe("invoice — issue", () => {
  it("won't issue until the seller's legal identity is configured", async () => {
    const { actor, order } = await setup("a", { legalIdentity: false });
    const invoice = await invoiceService.createInvoiceFromOrder(actor, { orderId: order.id });

    await expect(invoiceService.issueInvoice(actor, { id: invoice.id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("assigns a gapless number, freezes the parties, and marks the order invoiced", async () => {
    const { actor, order } = await setup("a");
    const year = new Date().getUTCFullYear();
    const invoice = await invoiceService.createInvoiceFromOrder(actor, { orderId: order.id });

    const issued = await invoiceService.issueInvoice(actor, { id: invoice.id });
    expect(issued.number).toBe(`INV-${year}-0001`);
    expect(issued.status).toBe("issued");
    expect(issued.issueDate).not.toBeNull();
    expect(issued.dueDate).not.toBeNull();
    expect(issued.sellerSnapshot).toMatchObject({ name: "Vendor SA", taxId: "B12345678" });
    expect(issued.billToSnapshot).toMatchObject({ name: "Acme SL" });

    const refreshed = await orderService.getOrder(actor.tenantId, order.id);
    expect(refreshed.invoiceStatus).toBe("invoiced");
  });

  it("issues gapless numbers under concurrency, per series", async () => {
    const { actor, account, products } = await setup("a");
    const year = new Date().getUTCFullYear();

    const drafts = await Promise.all(
      [0, 1, 2].map(async () => {
        const inv = await invoiceService.createBlankInvoice(actor, { accountId: account.id });
        await invoiceService.addInvoiceLine(actor, { invoiceId: inv.id, productId: products[0].id, quantity: 1 });
        return inv;
      }),
    );
    const issued = await Promise.all(drafts.map((d) => invoiceService.issueInvoice(actor, { id: d.id })));
    const numbers = issued.map((i) => i.number).sort();
    expect(numbers).toEqual([`INV-${year}-0001`, `INV-${year}-0002`, `INV-${year}-0003`]);
  });

  it("locks the line items once issued", async () => {
    const { actor, order, products } = await setup("a");
    const invoice = await invoiceService.createInvoiceFromOrder(actor, { orderId: order.id });
    await invoiceService.issueInvoice(actor, { id: invoice.id });

    await expect(
      invoiceService.addInvoiceLine(actor, { invoiceId: invoice.id, productId: products[0].id, quantity: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("invoice — over-invoice guard", () => {
  it("refuses to invoice an order line beyond what was ordered, across the order and shipment paths", async () => {
    const { actor, order, orderLines, warehouse } = await setup("a", {
      lines: [{ unitPrice: 10, taxRatePercent: 0, quantity: 10 }],
    });

    // ship 6 of the 10
    const { shipment } = await shipmentService.createShipment(actor, {
      orderId: order.id,
      shipFromWarehouseId: warehouse.id,
      lines: [{ orderLineItemId: orderLines[0].id, quantity: 6 }],
    });
    await shipmentService.transitionShipment(actor, { id: shipment.id, status: "shipped" });

    // invoice the whole order line (all 10) and issue it
    const full = await invoiceService.createInvoiceFromOrder(actor, { orderId: order.id });
    await invoiceService.issueInvoice(actor, { id: full.id });

    // nothing left on the order
    await expect(invoiceService.createInvoiceFromOrder(actor, { orderId: order.id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });

    // a from-shipment invoice can still be drafted, but issuing it would push the
    // order line past what was ordered
    const dup = await invoiceService.createInvoiceFromShipments(actor, {
      orderId: order.id,
      shipmentIds: [shipment.id],
    });
    await expect(invoiceService.issueInvoice(actor, { id: dup.id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});

describe("invoice — rectify (credit note)", () => {
  it("raises a REC- credit note, reverses the invoiced quantity, and keeps the original number", async () => {
    const { actor, order } = await setup("a", { lines: [{ unitPrice: 100, taxRatePercent: 21, quantity: 4 }] });
    const year = new Date().getUTCFullYear();
    const invoice = await invoiceService.createInvoiceFromOrder(actor, { orderId: order.id });
    const issued = await invoiceService.issueInvoice(actor, { id: invoice.id });

    const credit = await invoiceService.rectifyInvoice(actor, { id: issued.id, reason: "R1" });
    expect(credit.documentType).toBe("credit_note");
    expect(credit.number).toBe(`REC-${year}-0001`);
    expect(credit.rectifiesInvoiceId).toBe(issued.id);
    expect(credit.subtotalAmount).toBe("400.00");

    const original = await invoiceService.getInvoice(actor.tenantId, issued.id);
    expect(original.number).toBe(issued.number);
    expect(original.status).toBe("issued");

    const refreshed = await orderService.getOrder(actor.tenantId, order.id);
    expect(refreshed.invoiceStatus).toBe("uninvoiced");
  });

  it("supports a partial rectification", async () => {
    const { actor, order } = await setup("a", { lines: [{ unitPrice: 100, taxRatePercent: 0, quantity: 10 }] });
    const invoice = await invoiceService.createInvoiceFromOrder(actor, { orderId: order.id });
    const issued = await invoiceService.issueInvoice(actor, { id: invoice.id });
    const { lineItems } = await invoiceService.getInvoiceWithLineItems(actor.tenantId, issued.id);

    const credit = await invoiceService.rectifyInvoice(actor, {
      id: issued.id,
      reason: "R1",
      lines: [{ invoiceLineItemId: lineItems[0].id, quantity: 3 }],
    });
    expect(credit.subtotalAmount).toBe("300.00");

    const refreshed = await orderService.getOrder(actor.tenantId, order.id);
    expect(refreshed.invoiceStatus).toBe("partially_invoiced");
  });

  it("is manager-gated", async () => {
    const { actor, order } = await setup("a");
    const invoice = await invoiceService.createInvoiceFromOrder(actor, { orderId: order.id });
    const issued = await invoiceService.issueInvoice(actor, { id: invoice.id });

    await expect(
      invoiceService.rectifyInvoice({ ...actor, role: "sales_rep" }, { id: issued.id, reason: "R1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("invoice — from shipments", () => {
  it("bills exactly the shipped quantities", async () => {
    const { actor, order, orderLines, warehouse } = await setup("a", {
      lines: [{ unitPrice: 10, taxRatePercent: 0, quantity: 10 }],
    });
    const { shipment } = await shipmentService.createShipment(actor, {
      orderId: order.id,
      shipFromWarehouseId: warehouse.id,
      lines: [{ orderLineItemId: orderLines[0].id, quantity: 6 }],
    });
    await shipmentService.transitionShipment(actor, { id: shipment.id, status: "shipped" });

    const invoice = await invoiceService.createInvoiceFromShipments(actor, {
      orderId: order.id,
      shipmentIds: [shipment.id],
    });
    expect(invoice.subtotalAmount).toBe("60.00");
    const { lineItems } = await invoiceService.getInvoiceWithLineItems(actor.tenantId, invoice.id);
    expect(lineItems[0]).toMatchObject({ sourceType: "shipment_line", quantity: "6.000" });
  });
});

describe("invoice — reads", () => {
  it("derives overdue on the list once the due date has passed", async () => {
    const { actor, order } = await setup("a");
    const invoice = await invoiceService.createInvoiceFromOrder(actor, { orderId: order.id });
    const issued = await invoiceService.issueInvoice(actor, { id: invoice.id });

    let list = await invoiceService.listInvoices(actor.tenantId, {});
    expect(list.items[0].overdue).toBe(false);

    await withTenantContext(actor.tenantId, (tx) =>
      tx
        .update(invoices)
        .set({ dueDate: new Date(Date.now() - 86_400_000) })
        .where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.id, issued.id))),
    );

    list = await invoiceService.listInvoices(actor.tenantId, { overdueOnly: true });
    expect(list.items).toHaveLength(1);
    expect(list.items[0].overdue).toBe(true);
  });
});

describe("invoice — tenant isolation", () => {
  it("cannot touch another tenant's invoice", async () => {
    const { actor: a, order } = await setup("a");
    const { actor: b } = await setup("b");
    const invoice = await invoiceService.createInvoiceFromOrder(a, { orderId: order.id });

    await expect(invoiceService.getInvoice(b.tenantId, invoice.id)).rejects.toThrow(TRPCError);
    await expect(invoiceService.issueInvoice(b, { id: invoice.id })).rejects.toThrow(TRPCError);
    await expect(invoiceService.createInvoiceFromOrder(b, { orderId: order.id })).rejects.toThrow(TRPCError);
    const { items } = await invoiceService.listInvoices(b.tenantId, {});
    expect(items).toHaveLength(0);
  });
});
