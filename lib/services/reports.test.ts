import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
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
import * as inventoryService from "./inventory";
import * as orderService from "./order";
import * as invoiceService from "./invoice";
import * as paymentService from "./payment";
import * as reports from "./reports";

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

async function baseTenant(label: string) {
  const actor = await createActor(label);
  const account = await accountService.createAccount(actor.tenantId, { name: "Acme SL" });
  const warehouse = await warehouseService.createWarehouse(actor, { name: "Madrid", code: "MAD" });
  await tenantSettingsService.updateSettings(actor, { legalName: "Vendor SA", taxId: "B12345678" });
  return { actor, account, warehouse };
}

async function issuedInvoice(
  actor: ActorContext,
  accountId: string,
  warehouseId: string,
  lines: Array<{ unitPrice: number; costPrice?: number; taxRatePercent: number; quantity: number }>,
) {
  const products = await Promise.all(
    lines.map((l, i) =>
      productService.createProduct(actor.tenantId, {
        name: `P${i}-${crypto.randomUUID().slice(0, 4)}`,
        unitPrice: l.unitPrice,
        costPrice: l.costPrice ?? 0,
        taxRatePercent: l.taxRatePercent,
        tracksInventory: false,
      }),
    ),
  );
  const order = await orderService.createOrder(actor.tenantId, {
    accountId,
    lines: products.map((p, i) => ({ productId: p.id, quantity: lines[i].quantity })),
  });
  await orderService.confirmOrder(actor, { id: order.id, warehouseId });
  const draft = await invoiceService.createInvoiceFromOrder(actor, { orderId: order.id });
  return invoiceService.issueInvoice(actor, { id: draft.id });
}

describe("reports — stock valuation", () => {
  it("values on-hand stock at unit cost, by warehouse", async () => {
    const { actor, warehouse } = await baseTenant("a");
    const w2 = await warehouseService.createWarehouse(actor, { name: "Barcelona", code: "BCN" });
    const widget = await productService.createProduct(actor.tenantId, { name: "Widget", unitPrice: 10, costPrice: 4 });
    const gadget = await productService.createProduct(actor.tenantId, { name: "Gadget", unitPrice: 20, costPrice: 7.5 });

    await inventoryService.receiveStock(actor, { productId: widget.id, warehouseId: warehouse.id, quantity: 10 });
    await inventoryService.receiveStock(actor, { productId: gadget.id, warehouseId: warehouse.id, quantity: 4 });
    await inventoryService.receiveStock(actor, { productId: widget.id, warehouseId: w2.id, quantity: 2 });

    const report = await reports.stockValuation(actor.tenantId);
    expect(report.rows).toHaveLength(3);
    expect(report.rows.find((r) => r.productName === "Widget" && r.warehouseName === "Madrid")?.value).toBe("40.00");
    expect(report.rows.find((r) => r.productName === "Gadget")?.value).toBe("30.00"); // 4 × 7.50
    expect(report.grandTotal).toBe("78.00"); // 40 + 30 + 8
    expect(report.warehouseTotals).toContainEqual({ warehouseName: "Barcelona", value: "8.00" });
  });
});

describe("reports — AR aging", () => {
  it("buckets open invoice balances by days past due", async () => {
    const { actor, account, warehouse } = await baseTenant("a");
    const inv = await issuedInvoice(actor, account.id, warehouse.id, [
      { unitPrice: 100, taxRatePercent: 0, quantity: 1 },
    ]);
    // push the due date 45 days into the past → the 31-60 bucket
    await withTenantContext(actor.tenantId, (tx) =>
      tx
        .update(invoices)
        .set({ dueDate: new Date(Date.now() - 45 * 86_400_000) })
        .where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.id, inv.id))),
    );

    const report = await reports.arAging(actor.tenantId);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ accountName: "Acme SL", d31_60: "100.00", total: "100.00" });
    expect(report.totals.total).toBe("100.00");
  });

  it("only counts the unpaid remainder", async () => {
    const { actor, account, warehouse } = await baseTenant("a");
    const inv = await issuedInvoice(actor, account.id, warehouse.id, [
      { unitPrice: 100, taxRatePercent: 0, quantity: 1 },
    ]);
    await paymentService.recordPayment(actor, {
      accountId: account.id,
      amount: 70,
      allocations: [{ invoiceId: inv.id, amount: 70 }],
    });

    const report = await reports.arAging(actor.tenantId);
    expect(report.totals.total).toBe("30.00");
  });
});

describe("reports — margin", () => {
  it("computes revenue vs snapshotted cost per product, credit notes negative", async () => {
    const { actor, account, warehouse } = await baseTenant("a");
    const inv = await issuedInvoice(actor, account.id, warehouse.id, [
      { unitPrice: 100, costPrice: 60, taxRatePercent: 21, quantity: 2 },
    ]);

    let report = await reports.margin(actor.tenantId);
    expect(report.rows[0]).toMatchObject({ revenue: "200.00", cost: "120.00", margin: "80.00", marginPercent: "40.00" });

    await invoiceService.rectifyInvoice(actor, { id: inv.id, reason: "R1" });
    report = await reports.margin(actor.tenantId);
    expect(report.totals).toMatchObject({ revenue: "0.00", cost: "0.00", margin: "0.00" });
  });
});

describe("reports — sales by VAT rate", () => {
  it("groups taxable base and output VAT by rate", async () => {
    const { actor, account, warehouse } = await baseTenant("a");
    await issuedInvoice(actor, account.id, warehouse.id, [
      { unitPrice: 100, taxRatePercent: 21, quantity: 1 },
      { unitPrice: 50, taxRatePercent: 10, quantity: 1 },
    ]);

    const report = await reports.salesByTaxRate(actor.tenantId);
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0]).toMatchObject({ taxRatePercent: "21.00", base: "100.00", tax: "21.00" });
    expect(report.rows[1]).toMatchObject({ taxRatePercent: "10.00", base: "50.00", tax: "5.00" });
    expect(report.totals).toEqual({ base: "150.00", tax: "26.00" });
  });

  it("renders a CSV with a totals row", async () => {
    const { actor, account, warehouse } = await baseTenant("a");
    await issuedInvoice(actor, account.id, warehouse.id, [{ unitPrice: 100, taxRatePercent: 21, quantity: 1 }]);
    const csv = reports.salesByTaxRateCsv(await reports.salesByTaxRate(actor.tenantId));
    expect(csv.split("\r\n")[0]).toBe(`"Rate %","Treatment","Base","VAT"`);
    expect(csv).toContain(`"Total","","100.00","21.00"`);
  });
});

describe("reports — tenant isolation", () => {
  it("never mixes another tenant's figures in", async () => {
    const { actor: a, account: accA, warehouse: whA } = await baseTenant("a");
    await issuedInvoice(a, accA.id, whA.id, [{ unitPrice: 100, taxRatePercent: 21, quantity: 1 }]);

    const { actor: b } = await baseTenant("b");
    const aging = await reports.arAging(b.tenantId);
    const sales = await reports.salesByTaxRate(b.tenantId);
    const valuation = await reports.stockValuation(b.tenantId);
    expect(aging.rows).toHaveLength(0);
    expect(sales.rows).toHaveLength(0);
    expect(valuation.rows).toHaveLength(0);
  });
});
