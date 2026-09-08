import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import * as pipelineService from "./pipeline";
import * as leadService from "./lead";
import * as productService from "./product";
import * as quoteService from "./quote";
import { calculateLineItemTotalCents, calculateQuoteTotalCents } from "./quote";

const createdTenantIds: string[] = [];

afterEach(async () => {
  for (const tenantId of createdTenantIds.splice(0)) {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  }
});

async function createTenantWithOpportunity(label: string) {
  const [tenant] = await db
    .insert(tenants)
    .values({ clerkOrgId: `org_${label}_${crypto.randomUUID()}`, name: `Tenant ${label}` })
    .returning();
  createdTenantIds.push(tenant.id);
  await pipelineService.seedDefaultPipeline(tenant.id);

  const lead = await leadService.createLead(tenant.id, { firstName: "Jane", lastName: "Doe" });
  const opportunity = await leadService.convertLeadToOpportunity(tenant.id, { leadId: lead.id });

  return { tenant, opportunity };
}

describe("quote calculations (pure)", () => {
  it("multiplies unit price by quantity in integer cents", () => {
    expect(calculateLineItemTotalCents("19.99", 3)).toBe(5997);
    expect(calculateLineItemTotalCents("0.10", 3)).toBe(30);
    expect(calculateLineItemTotalCents("100.00", 1)).toBe(10000);
  });

  it("sums line items without floating-point drift", () => {
    const lineItems = [
      { unitPrice: "0.10", quantity: 3 },
      { unitPrice: "0.20", quantity: 3 },
    ];
    // naive float math (0.1*3 + 0.2*3) is famously 0.8999999999999999
    expect(calculateQuoteTotalCents(lineItems)).toBe(90);
  });

  it("returns 0 for an empty line item list", () => {
    expect(calculateQuoteTotalCents([])).toBe(0);
  });
});

describe("quote line-item quantity bounds", () => {
  const base = { quoteId: crypto.randomUUID(), productId: crypto.randomUUID() };

  it("accepts a quantity up to 1,000,000", () => {
    expect(quoteService.addLineItemInput.safeParse({ ...base, quantity: 1 }).success).toBe(true);
    expect(quoteService.addLineItemInput.safeParse({ ...base, quantity: 1_000_000 }).success).toBe(true);
  });

  it("rejects a quantity above 1,000,000 on add and on update", () => {
    expect(quoteService.addLineItemInput.safeParse({ ...base, quantity: 1_000_001 }).success).toBe(false);
    expect(
      quoteService.updateLineItemQuantityInput.safeParse({ id: crypto.randomUUID(), quantity: 1_000_001 }).success,
    ).toBe(false);
  });

  it("still rejects zero, negative, and non-integer quantities", () => {
    for (const quantity of [0, -1, 2.5]) {
      expect(quoteService.addLineItemInput.safeParse({ ...base, quantity }).success).toBe(false);
    }
  });
});

describe("quote service", () => {
  it("creates a quote, adds line items snapshotting product price, and computes the total", async () => {
    const { tenant, opportunity } = await createTenantWithOpportunity("a");
    const widget = await productService.createProduct(tenant.id, { name: "Widget", unitPrice: 10 });
    const gadget = await productService.createProduct(tenant.id, { name: "Gadget", unitPrice: 25.5 });

    const quote = await quoteService.createQuote(tenant.id, { opportunityId: opportunity.id });
    await quoteService.addLineItem(tenant.id, { quoteId: quote.id, productId: widget.id, quantity: 2 });
    await quoteService.addLineItem(tenant.id, { quoteId: quote.id, productId: gadget.id, quantity: 1 });

    const result = await quoteService.getQuoteWithLineItems(tenant.id, quote.id);
    expect(result.lineItems).toHaveLength(2);
    expect(result.total).toBe("45.50"); // 2*10 + 1*25.50

    // changing the catalog price afterward must not retroactively change the quote
    await productService.updateProduct(tenant.id, { id: widget.id, name: "Widget", unitPrice: 999 });
    const afterPriceChange = await quoteService.getQuoteWithLineItems(tenant.id, quote.id);
    expect(afterPriceChange.total).toBe("45.50");
  });

  it("updates and removes line items", async () => {
    const { tenant, opportunity } = await createTenantWithOpportunity("a");
    const widget = await productService.createProduct(tenant.id, { name: "Widget", unitPrice: 10 });
    const quote = await quoteService.createQuote(tenant.id, { opportunityId: opportunity.id });
    const lineItem = await quoteService.addLineItem(tenant.id, {
      quoteId: quote.id,
      productId: widget.id,
      quantity: 1,
    });

    await quoteService.updateLineItemQuantity(tenant.id, { id: lineItem.id, quantity: 4 });
    const afterUpdate = await quoteService.getQuoteWithLineItems(tenant.id, quote.id);
    expect(afterUpdate.total).toBe("40.00");

    await quoteService.removeLineItem(tenant.id, lineItem.id);
    const afterRemove = await quoteService.getQuoteWithLineItems(tenant.id, quote.id);
    expect(afterRemove.lineItems).toHaveLength(0);
    expect(afterRemove.total).toBe("0.00");
  });

  it("rejects creating a quote for an opportunity belonging to another tenant", async () => {
    const { tenant: tenantA } = await createTenantWithOpportunity("a");
    const { opportunity: opportunityB } = await createTenantWithOpportunity("b");

    await expect(
      quoteService.createQuote(tenantA.id, { opportunityId: opportunityB.id }),
    ).rejects.toThrow(TRPCError);
  });

  it("rejects adding a line item using another tenant's product", async () => {
    const { tenant: tenantA, opportunity } = await createTenantWithOpportunity("a");
    const { tenant: tenantB } = await createTenantWithOpportunity("b");
    const foreignProduct = await productService.createProduct(tenantB.id, { name: "Foreign", unitPrice: 5 });

    const quote = await quoteService.createQuote(tenantA.id, { opportunityId: opportunity.id });

    await expect(
      quoteService.addLineItem(tenantA.id, { quoteId: quote.id, productId: foreignProduct.id, quantity: 1 }),
    ).rejects.toThrow(TRPCError);
  });

  it("rejects reading, adding to, or deleting a quote belonging to another tenant", async () => {
    const { tenant: tenantA, opportunity } = await createTenantWithOpportunity("a");
    const { tenant: tenantB } = await createTenantWithOpportunity("b");
    const product = await productService.createProduct(tenantB.id, { name: "Widget", unitPrice: 5 });

    const quote = await quoteService.createQuote(tenantA.id, { opportunityId: opportunity.id });

    await expect(quoteService.getQuoteWithLineItems(tenantB.id, quote.id)).rejects.toThrow(TRPCError);
    await expect(
      quoteService.addLineItem(tenantB.id, { quoteId: quote.id, productId: product.id, quantity: 1 }),
    ).rejects.toThrow(TRPCError);
    await expect(quoteService.deleteQuote(tenantB.id, quote.id)).rejects.toThrow(TRPCError);
  });
});

describe("quote service — list", () => {
  it("lists quotes with the opportunity name and computed total, filters by search, and paginates", async () => {
    const { tenant, opportunity } = await createTenantWithOpportunity("a");
    const widget = await productService.createProduct(tenant.id, { name: "Widget", unitPrice: 10 });

    const quote = await quoteService.createQuote(tenant.id, { opportunityId: opportunity.id });
    await quoteService.addLineItem(tenant.id, { quoteId: quote.id, productId: widget.id, quantity: 3 });

    const all = await quoteService.listQuotes(tenant.id);
    expect(all.total).toBe(1);
    expect(all.items).toEqual([
      expect.objectContaining({ id: quote.id, opportunityName: opportunity.name, total: "30.00" }),
    ]);

    const matched = await quoteService.listQuotes(tenant.id, { page: 1, search: opportunity.name.slice(0, 3) });
    expect(matched.total).toBe(1);

    const unmatched = await quoteService.listQuotes(tenant.id, { page: 1, search: "no such opportunity" });
    expect(unmatched.total).toBe(0);
    expect(unmatched.items).toHaveLength(0);
  });

  it("scopes listQuotes to the requesting tenant", async () => {
    const { tenant: tenantA, opportunity: opportunityA } = await createTenantWithOpportunity("a");
    const { tenant: tenantB } = await createTenantWithOpportunity("b");
    await quoteService.createQuote(tenantA.id, { opportunityId: opportunityA.id });

    const listedByB = await quoteService.listQuotes(tenantB.id);
    expect(listedByB.items).toHaveLength(0);
    expect(listedByB.total).toBe(0);
  });
});
