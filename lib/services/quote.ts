import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { quotes, quoteLineItems } from "@/lib/db/schema/quote";
import { opportunities } from "@/lib/db/schema/opportunity";
import { products } from "@/lib/db/schema/product";
import { withTenantContext } from "@/lib/db/tenant-context";
import { computeDocumentTotals, divRound, sumAmounts, toCents } from "@/lib/money";
import { getOpportunity } from "./opportunity";

export const PAGE_SIZE = 20;

// All money/tax arithmetic now goes through `lib/money.ts` (BigInt, deterministic
// — CLAUDE.md §12). A quote is an **ex-tax** estimate: it carries the list price,
// the line discount and a cost snapshot, exactly like the order it becomes, but
// VAT is only modelled downstream on the order / invoice from the product.

/** Legacy pure helper — kept for callers/tests that want a line total in cents. */
export function calculateLineItemTotalCents(unitPrice: string, quantity: number): number {
  return Number(divRound(toCents(unitPrice) * BigInt(Math.round(quantity * 1_000)), 1_000n));
}

export function calculateQuoteTotalCents(lineItems: { unitPrice: string; quantity: number }[]): number {
  return lineItems.reduce((sum, item) => sum + calculateLineItemTotalCents(item.unitPrice, item.quantity), 0);
}

/** The frozen `netUnitPrice` / line base for a quote line, via the shared pipeline. */
function lineCalc(listUnitPrice: string, quantity: string, discountPercent: string) {
  const [line] = computeDocumentTotals([
    { listUnitPrice, quantity, discountPercent, taxRatePercent: "0", taxTreatment: "exempt" },
  ]).lines;
  return { netUnitPrice: line.netUnitPrice, lineTotal: line.lineBase };
}

export const createQuoteInput = z.object({
  opportunityId: z.string().uuid(),
});

// Upper bound keeps a single line total well inside the numeric(12,2) money
// ceiling — without a cap, a pasted/fat-fingered value surfaces as a raw DB
// error instead of validation. Quantity is decimal (numeric(12,3)) so a quote
// can price 2.5 kg or 1.75 hours.
export const lineItemQuantity = z.number().positive().multipleOf(0.001).max(1_000_000);
export const lineItemDiscountPercent = z.number().min(0).max(100).multipleOf(0.01);

export const addLineItemInput = z.object({
  quoteId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: lineItemQuantity,
  discountPercent: lineItemDiscountPercent.default(0),
});

export const updateLineItemQuantityInput = z.object({
  id: z.string().uuid(),
  quantity: lineItemQuantity.optional(),
  discountPercent: lineItemDiscountPercent.optional(),
});

export const listQuotesInput = z.object({
  page: z.number().int().min(1).default(1),
  // Filters by the linked opportunity's name — a quote has no name of its own.
  search: z.string().trim().max(200).default(""),
});

// No index/list UI existed until this pass (CLAUDE.md §18) — quotes were only
// reachable via their Opportunity. Each row joins the opportunity for display
// and sums its line items in Postgres (exact numeric arithmetic, not JS float
// — CLAUDE.md §12) rather than reusing calculateQuoteTotalCents per row.
export async function listQuotes(tenantId: string, rawInput: z.input<typeof listQuotesInput> = {}) {
  const input = listQuotesInput.parse(rawInput);
  return withTenantContext(tenantId, async (tx) => {
    const conditions = [eq(quotes.tenantId, tenantId), isNull(quotes.deletedAt)];
    if (input.search) {
      conditions.push(ilike(opportunities.name, `%${input.search}%`));
    }
    const where = and(...conditions);

    const [items, [{ total }]] = await Promise.all([
      tx
        .select({
          id: quotes.id,
          opportunityId: quotes.opportunityId,
          opportunityName: opportunities.name,
          createdAt: quotes.createdAt,
          total: sql<string>`round(coalesce(sum(${quoteLineItems.quantity} * ${quoteLineItems.netUnitPrice}), 0), 2)`,
        })
        .from(quotes)
        .innerJoin(opportunities, eq(quotes.opportunityId, opportunities.id))
        .leftJoin(quoteLineItems, eq(quoteLineItems.quoteId, quotes.id))
        .where(where)
        .groupBy(quotes.id, opportunities.name)
        .orderBy(desc(quotes.createdAt))
        .limit(PAGE_SIZE)
        .offset((input.page - 1) * PAGE_SIZE),
      tx
        .select({ total: count() })
        .from(quotes)
        .innerJoin(opportunities, eq(quotes.opportunityId, opportunities.id))
        .where(where),
    ]);

    return { items, total };
  });
}

export function listQuotesByOpportunity(tenantId: string, opportunityId: string) {
  return withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(quotes)
      .where(and(eq(quotes.tenantId, tenantId), eq(quotes.opportunityId, opportunityId), isNull(quotes.deletedAt)))
      .orderBy(asc(quotes.createdAt)),
  );
}

async function requireQuote(tenantId: string, id: string) {
  const [quote] = await withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(quotes)
      .where(and(eq(quotes.tenantId, tenantId), eq(quotes.id, id), isNull(quotes.deletedAt))),
  );
  if (!quote) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Quote not found" });
  }
  return quote;
}

export async function getQuoteWithLineItems(tenantId: string, id: string) {
  const quote = await requireQuote(tenantId, id);

  const rows = await withTenantContext(tenantId, (tx) =>
    tx
      .select({
        id: quoteLineItems.id,
        productId: quoteLineItems.productId,
        productName: products.name,
        quantity: quoteLineItems.quantity,
        unitOfMeasure: quoteLineItems.unitOfMeasure,
        unitPrice: quoteLineItems.unitPrice,
        discountPercent: quoteLineItems.discountPercent,
        netUnitPrice: quoteLineItems.netUnitPrice,
      })
      .from(quoteLineItems)
      .innerJoin(products, eq(quoteLineItems.productId, products.id))
      .where(and(eq(quoteLineItems.tenantId, tenantId), eq(quoteLineItems.quoteId, id)))
      .orderBy(asc(quoteLineItems.createdAt)),
  );

  const lineItems = rows.map((row) => ({
    ...row,
    lineTotal: lineCalc(row.unitPrice, row.quantity, row.discountPercent).lineTotal,
  }));

  const total = sumAmounts(lineItems.map((item) => item.lineTotal));
  return { quote, lineItems, subtotal: total, total };
}

export async function createQuote(tenantId: string, input: z.infer<typeof createQuoteInput>) {
  await getOpportunity(tenantId, input.opportunityId); // confirms it exists in this tenant

  const [quote] = await withTenantContext(tenantId, (tx) =>
    tx.insert(quotes).values({ tenantId, opportunityId: input.opportunityId }).returning(),
  );
  return quote;
}

export async function deleteQuote(tenantId: string, id: string) {
  const [quote] = await withTenantContext(tenantId, (tx) =>
    tx
      .update(quotes)
      .set({ deletedAt: new Date() })
      .where(and(eq(quotes.tenantId, tenantId), eq(quotes.id, id), isNull(quotes.deletedAt)))
      .returning(),
  );
  if (!quote) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Quote not found" });
  }
  return quote;
}

export async function addLineItem(tenantId: string, rawInput: z.input<typeof addLineItemInput>) {
  const input = addLineItemInput.parse(rawInput);
  await requireQuote(tenantId, input.quoteId);

  return withTenantContext(tenantId, async (tx) => {
    const [product] = await tx
      .select()
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, input.productId), isNull(products.deletedAt)));
    if (!product) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
    }

    const quantity = input.quantity.toFixed(3);
    const discountPercent = input.discountPercent.toFixed(2);
    const [lineItem] = await tx
      .insert(quoteLineItems)
      .values({
        tenantId,
        quoteId: input.quoteId,
        productId: input.productId,
        quantity,
        unitOfMeasure: product.unitOfMeasure,
        unitPrice: product.unitPrice,
        discountPercent,
        netUnitPrice: lineCalc(product.unitPrice, quantity, discountPercent).netUnitPrice,
        unitCost: product.costPrice,
      })
      .returning();
    return lineItem;
  });
}

/** Kept its name (and router/UI wiring) though it now also updates the discount. */
export async function updateLineItemQuantity(
  tenantId: string,
  rawInput: z.input<typeof updateLineItemQuantityInput>,
) {
  const input = updateLineItemQuantityInput.parse(rawInput);
  return withTenantContext(tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(quoteLineItems)
      .where(and(eq(quoteLineItems.tenantId, tenantId), eq(quoteLineItems.id, input.id)));
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Line item not found" });

    const quantity = input.quantity !== undefined ? input.quantity.toFixed(3) : existing.quantity;
    const discountPercent =
      input.discountPercent !== undefined ? input.discountPercent.toFixed(2) : existing.discountPercent;

    const [lineItem] = await tx
      .update(quoteLineItems)
      .set({
        quantity,
        discountPercent,
        netUnitPrice: lineCalc(existing.unitPrice, quantity, discountPercent).netUnitPrice,
      })
      .where(and(eq(quoteLineItems.tenantId, tenantId), eq(quoteLineItems.id, input.id)))
      .returning();
    return lineItem;
  });
}

export async function removeLineItem(tenantId: string, id: string) {
  const [lineItem] = await withTenantContext(tenantId, (tx) =>
    tx
      .delete(quoteLineItems)
      .where(and(eq(quoteLineItems.tenantId, tenantId), eq(quoteLineItems.id, id)))
      .returning(),
  );
  if (!lineItem) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Line item not found" });
  }
  return lineItem;
}
