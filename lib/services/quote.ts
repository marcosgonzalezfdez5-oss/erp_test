import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { quotes, quoteLineItems } from "@/lib/db/schema/quote";
import { products } from "@/lib/db/schema/product";
import { withTenantContext } from "@/lib/db/tenant-context";
import { getOpportunity } from "./opportunity";

// Money is stored as a numeric(12,2) string. All arithmetic happens in
// integer cents so totals are exact and never drift like float math would
// (CLAUDE.md §9: financial calculations must be deterministic plain code).
function priceToCents(price: string): number {
  const [whole, fraction = ""] = price.split(".");
  const sign = whole.startsWith("-") ? -1 : 1;
  const wholeDigits = whole.replace("-", "") || "0";
  const paddedFraction = (fraction + "00").slice(0, 2);
  return sign * (Number(wholeDigits) * 100 + Number(paddedFraction));
}

function centsToPrice(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  return `${sign}${whole}.${String(fraction).padStart(2, "0")}`;
}

export function calculateLineItemTotalCents(unitPrice: string, quantity: number): number {
  return priceToCents(unitPrice) * quantity;
}

export function calculateQuoteTotalCents(lineItems: { unitPrice: string; quantity: number }[]): number {
  return lineItems.reduce((sum, item) => sum + calculateLineItemTotalCents(item.unitPrice, item.quantity), 0);
}

export const createQuoteInput = z.object({
  opportunityId: z.string().uuid(),
});

export const addLineItemInput = z.object({
  quoteId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
});

export const updateLineItemQuantityInput = z.object({
  id: z.string().uuid(),
  quantity: z.number().int().positive(),
});

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
        unitPrice: quoteLineItems.unitPrice,
      })
      .from(quoteLineItems)
      .innerJoin(products, eq(quoteLineItems.productId, products.id))
      .where(and(eq(quoteLineItems.tenantId, tenantId), eq(quoteLineItems.quoteId, id)))
      .orderBy(asc(quoteLineItems.createdAt)),
  );

  const lineItems = rows.map((row) => ({
    ...row,
    lineTotal: centsToPrice(calculateLineItemTotalCents(row.unitPrice, row.quantity)),
  }));

  return { quote, lineItems, total: centsToPrice(calculateQuoteTotalCents(rows)) };
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

export async function addLineItem(tenantId: string, input: z.infer<typeof addLineItemInput>) {
  await requireQuote(tenantId, input.quoteId);

  return withTenantContext(tenantId, async (tx) => {
    const [product] = await tx
      .select()
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, input.productId), isNull(products.deletedAt)));
    if (!product) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
    }

    const [lineItem] = await tx
      .insert(quoteLineItems)
      .values({
        tenantId,
        quoteId: input.quoteId,
        productId: input.productId,
        quantity: input.quantity,
        unitPrice: product.unitPrice,
      })
      .returning();
    return lineItem;
  });
}

export async function updateLineItemQuantity(tenantId: string, input: z.infer<typeof updateLineItemQuantityInput>) {
  const [lineItem] = await withTenantContext(tenantId, (tx) =>
    tx
      .update(quoteLineItems)
      .set({ quantity: input.quantity })
      .where(and(eq(quoteLineItems.tenantId, tenantId), eq(quoteLineItems.id, input.id)))
      .returning(),
  );
  if (!lineItem) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Line item not found" });
  }
  return lineItem;
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
