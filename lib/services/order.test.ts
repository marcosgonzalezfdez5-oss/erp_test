import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import { users } from "@/lib/db/schema/user";
import type { ActorContext } from "@/lib/auth/actor";
import type { MembershipRole } from "@/lib/db/schema/membership";
import * as accountService from "./account";
import * as pipelineService from "./pipeline";
import * as leadService from "./lead";
import * as opportunityService from "./opportunity";
import * as productService from "./product";
import * as quoteService from "./quote";
import * as warehouseService from "./warehouse";
import * as tenantSettingsService from "./tenant-settings";
import * as orderService from "./order";

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

async function wonOpportunityWithQuote(
  tenantId: string,
  lines: Array<{ productId: string; quantity: number }>,
) {
  const lead = await leadService.createLead(tenantId, { firstName: "Jane", lastName: "Doe" });
  const opportunity = await leadService.convertLeadToOpportunity(tenantId, { leadId: lead.id });
  const quote = await quoteService.createQuote(tenantId, { opportunityId: opportunity.id });
  for (const line of lines) {
    await quoteService.addLineItem(tenantId, { quoteId: quote.id, productId: line.productId, quantity: line.quantity });
  }
  const stages = await pipelineService.listPipelineStages(tenantId);
  const won = stages.find((s) => s.kind === "won")!;
  await opportunityService.moveOpportunityToStage(tenantId, { id: opportunity.id, pipelineStageId: won.id });
  return { opportunity };
}

describe("order — creation from a won opportunity", () => {
  it("snapshots the latest quote's lines into a draft order with computed totals", async () => {
    const actor = await createActor("a");
    const widget = await productService.createProduct(actor.tenantId, { name: "Widget", unitPrice: 10 });
    const gadget = await productService.createProduct(actor.tenantId, { name: "Gadget", unitPrice: 25.5 });

    const { opportunity } = await wonOpportunityWithQuote(actor.tenantId, [
      { productId: widget.id, quantity: 2 },
      { productId: gadget.id, quantity: 1 },
    ]);

    const order = await orderService.getOrderByOpportunity(actor.tenantId, opportunity.id);
    expect(order).not.toBeNull();
    expect(order!.status).toBe("draft");
    expect(order!.number).toBeNull(); // not assigned until confirm
    expect(order!.subtotalAmount).toBe("45.50"); // 2*10 + 1*25.50
    expect(order!.taxAmount).toBe("9.56"); // 21% of 45.50, rounded on the rate-group base
    expect(order!.totalAmount).toBe("55.06");

    const { lineItems } = await orderService.getOrderWithLineItems(actor.tenantId, order!.id);
    expect(lineItems).toHaveLength(2);
    expect(lineItems[0]).toMatchObject({ description: "Widget", quantity: "2.000", netUnitPrice: "10.00" });
  });

  it("does not change a placed order's total when the catalogue price later changes", async () => {
    const actor = await createActor("a");
    const widget = await productService.createProduct(actor.tenantId, { name: "Widget", unitPrice: 10 });
    const { opportunity } = await wonOpportunityWithQuote(actor.tenantId, [{ productId: widget.id, quantity: 2 }]);

    const before = await orderService.getOrderByOpportunity(actor.tenantId, opportunity.id);
    await productService.updateProduct(actor.tenantId, { id: widget.id, name: "Widget", unitPrice: 999 });
    const after = await orderService.getOrderByOpportunity(actor.tenantId, opportunity.id);

    expect(after!.subtotalAmount).toBe(before!.subtotalAmount);
    expect(after!.subtotalAmount).toBe("20.00");
  });

  it("creates the order exactly once even if the opportunity is re-won", async () => {
    const actor = await createActor("a");
    const widget = await productService.createProduct(actor.tenantId, { name: "Widget", unitPrice: 10 });
    const { opportunity } = await wonOpportunityWithQuote(actor.tenantId, [{ productId: widget.id, quantity: 1 }]);

    const first = await orderService.getOrderByOpportunity(actor.tenantId, opportunity.id);
    const stages = await pipelineService.listPipelineStages(actor.tenantId);
    const won = stages.find((s) => s.kind === "won")!;
    await opportunityService.moveOpportunityToStage(actor.tenantId, { id: opportunity.id, pipelineStageId: won.id });
    const second = await orderService.getOrderByOpportunity(actor.tenantId, opportunity.id);

    expect(second!.id).toBe(first!.id);
  });

  it("creates an empty draft order when the opportunity has no quote", async () => {
    const actor = await createActor("a");
    const lead = await leadService.createLead(actor.tenantId, { firstName: "No", lastName: "Quote" });
    const opportunity = await leadService.convertLeadToOpportunity(actor.tenantId, { leadId: lead.id });
    const stages = await pipelineService.listPipelineStages(actor.tenantId);
    const won = stages.find((s) => s.kind === "won")!;
    await opportunityService.moveOpportunityToStage(actor.tenantId, { id: opportunity.id, pipelineStageId: won.id });

    const order = await orderService.getOrderByOpportunity(actor.tenantId, opportunity.id);
    expect(order!.totalAmount).toBe("0.00");
    expect((await orderService.getOrderWithLineItems(actor.tenantId, order!.id)).lineItems).toHaveLength(0);
  });
});

describe("order — standalone creation", () => {
  it("creates a draft order for an account with discount and tax applied deterministically", async () => {
    const actor = await createActor("a");
    const account = await accountService.createAccount(actor.tenantId, { name: "Acme" });

    const product = await productService.createProduct(actor.tenantId, {
      name: "Sheet metal",
      unitPrice: 100,
      taxRatePercent: 10,
    });

    const order = await orderService.createOrder(actor.tenantId, {
      accountId: account.id,
      lines: [{ productId: product.id, quantity: 10, discountPercent: 15 }],
    });

    expect(order.status).toBe("draft");
    expect(order.accountId).toBe(account.id);
    expect(order.subtotalAmount).toBe("850.00"); // 10 * (100 - 15%)
    expect(order.taxAmount).toBe("85.00"); // 10% of 850
    expect(order.totalAmount).toBe("935.00");
  });

  it("applies IRPF withholding when the tenant and product opt in", async () => {
    const actor = await createActor("a");
    await tenantSettingsService.updateSettings(actor, { irpfEnabled: true, irpfRatePercent: 15 });
    const service = await productService.createProduct(actor.tenantId, {
      name: "Consulting",
      unitPrice: 1000,
      taxRatePercent: 21,
      subjectToWithholding: true,
      tracksInventory: false,
    });

    const order = await orderService.createOrder(actor.tenantId, {
      lines: [{ productId: service.id, quantity: 1 }],
    });

    expect(order.subtotalAmount).toBe("1000.00");
    expect(order.taxAmount).toBe("210.00");
    expect(order.withholdingAmount).toBe("150.00");
    expect(order.totalAmount).toBe("1060.00");
  });

  it("rejects a foreign account or product", async () => {
    const a = await createActor("a");
    const b = await createActor("b");
    const foreignProduct = await productService.createProduct(b.tenantId, { name: "Foreign", unitPrice: 5 });

    await expect(
      orderService.createOrder(a.tenantId, { lines: [{ productId: foreignProduct.id, quantity: 1 }] }),
    ).rejects.toThrow(TRPCError);
  });
});

describe("order — line editing (draft only)", () => {
  it("adds, updates and removes lines and keeps the total in sync", async () => {
    const actor = await createActor("a");
    const widget = await productService.createProduct(actor.tenantId, { name: "Widget", unitPrice: 10, taxRatePercent: 0 });
    const order = await orderService.createOrder(actor.tenantId, { lines: [] });

    const line = await orderService.addLineItem(actor.tenantId, { orderId: order.id, productId: widget.id, quantity: 3 });
    expect((await orderService.getOrder(actor.tenantId, order.id)).subtotalAmount).toBe("30.00");

    await orderService.updateLineItem(actor.tenantId, { id: line.id, quantity: 5 });
    expect((await orderService.getOrder(actor.tenantId, order.id)).subtotalAmount).toBe("50.00");

    await orderService.removeLineItem(actor.tenantId, line.id);
    expect((await orderService.getOrder(actor.tenantId, order.id)).subtotalAmount).toBe("0.00");
  });

  it("refuses to edit a line once the order is confirmed", async () => {
    const actor = await createActor("a");
    const widget = await productService.createProduct(actor.tenantId, { name: "Widget", unitPrice: 10 });
    const order = await orderService.createOrder(actor.tenantId, {
      lines: [{ productId: widget.id, quantity: 1 }],
    });
    await orderService.confirmOrder(actor, { id: order.id });

    await expect(
      orderService.addLineItem(actor.tenantId, { orderId: order.id, productId: widget.id, quantity: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("order — confirm and cancel", () => {
  it("assigns sequential SO- numbers on confirm and pins the default warehouse", async () => {
    const actor = await createActor("a");
    await warehouseService.createWarehouse(actor, { name: "Madrid", code: "MAD" });
    const widget = await productService.createProduct(actor.tenantId, { name: "Widget", unitPrice: 10 });

    const o1 = await orderService.createOrder(actor.tenantId, { lines: [{ productId: widget.id, quantity: 1 }] });
    const o2 = await orderService.createOrder(actor.tenantId, { lines: [{ productId: widget.id, quantity: 1 }] });

    const year = new Date().getUTCFullYear();
    const c1 = await orderService.confirmOrder(actor, { id: o1.id });
    const c2 = await orderService.confirmOrder(actor, { id: o2.id });

    expect(c1.number).toBe(`SO-${year}-0001`);
    expect(c2.number).toBe(`SO-${year}-0002`);
    expect(c1.status).toBe("confirmed");
    expect(c1.warehouseId).not.toBeNull();
  });

  it("rejects confirming a non-draft order", async () => {
    const actor = await createActor("a");
    const order = await orderService.createOrder(actor.tenantId, { lines: [] });
    await orderService.confirmOrder(actor, { id: order.id });
    await expect(orderService.confirmOrder(actor, { id: order.id })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("cancels a draft order but only for a manager", async () => {
    const actor = await createActor("a");
    const order = await orderService.createOrder(actor.tenantId, { lines: [] });

    await expect(
      orderService.cancelOrder({ ...actor, role: "sales_rep" }, { id: order.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const cancelled = await orderService.cancelOrder(actor, { id: order.id, reason: "duplicate" });
    expect(cancelled.status).toBe("cancelled");
    await expect(orderService.cancelOrder(actor, { id: order.id })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("order — listing and tenant isolation", () => {
  it("lists orders scoped to the tenant with a status filter", async () => {
    const actor = await createActor("a");
    const widget = await productService.createProduct(actor.tenantId, { name: "Widget", unitPrice: 10 });
    const draft = await orderService.createOrder(actor.tenantId, { lines: [{ productId: widget.id, quantity: 1 }] });
    const confirmed = await orderService.createOrder(actor.tenantId, { lines: [{ productId: widget.id, quantity: 1 }] });
    await orderService.confirmOrder(actor, { id: confirmed.id });

    const all = await orderService.listOrders(actor.tenantId);
    expect(all.total).toBe(2);

    const drafts = await orderService.listOrders(actor.tenantId, { page: 1, search: "", status: "draft" });
    expect(drafts.items.map((o) => o.id)).toEqual([draft.id]);
  });

  it("cannot read, confirm, edit or cancel another tenant's order", async () => {
    const a = await createActor("a");
    const b = await createActor("b");
    const widget = await productService.createProduct(a.tenantId, { name: "Widget", unitPrice: 10 });
    const order = await orderService.createOrder(a.tenantId, { lines: [{ productId: widget.id, quantity: 1 }] });

    await expect(orderService.getOrderWithLineItems(b.tenantId, order.id)).rejects.toThrow(TRPCError);
    await expect(orderService.confirmOrder(b, { id: order.id })).rejects.toThrow(TRPCError);
    await expect(
      orderService.addLineItem(b.tenantId, { orderId: order.id, productId: widget.id, quantity: 1 }),
    ).rejects.toThrow(TRPCError);
    await expect(orderService.cancelOrder(b, { id: order.id })).rejects.toThrow(TRPCError);
    expect((await orderService.listOrders(b.tenantId)).total).toBe(0);
  });
});
