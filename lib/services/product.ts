import { TRPCError } from "@trpc/server";
import { and, count, eq, ilike, isNull } from "drizzle-orm";
import { z } from "zod";
import { products } from "@/lib/db/schema/product";
import { withTenantContext } from "@/lib/db/tenant-context";

export const PAGE_SIZE = 20;

const money = z.number().nonnegative().multipleOf(0.01);

export const createProductInput = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(100).optional(),
  unitPrice: money,
});

export const updateProductInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(100).optional(),
  unitPrice: money,
});

export const listProductsInput = z.object({
  page: z.number().int().min(1).default(1),
  // Overridable so pickers that need the (near-)full catalog — e.g. the quote
  // line-item product select — aren't capped at the list page's default size.
  pageSize: z.number().int().min(1).max(200).default(PAGE_SIZE),
  search: z.string().trim().max(200).default(""),
});

export async function listProducts(tenantId: string, rawInput: z.input<typeof listProductsInput> = {}) {
  const input = listProductsInput.parse(rawInput);
  return withTenantContext(tenantId, async (tx) => {
    const conditions = [eq(products.tenantId, tenantId), isNull(products.deletedAt)];
    if (input.search) {
      conditions.push(ilike(products.name, `%${input.search}%`));
    }
    const where = and(...conditions);

    const [items, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(products)
        .where(where)
        .orderBy(products.name)
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize),
      tx.select({ total: count() }).from(products).where(where),
    ]);

    return { items, total };
  });
}

export async function getProduct(tenantId: string, id: string) {
  const [product] = await withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, id), isNull(products.deletedAt))),
  );
  if (!product) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
  }
  return product;
}

export async function createProduct(tenantId: string, input: z.infer<typeof createProductInput>) {
  const [product] = await withTenantContext(tenantId, (tx) =>
    tx
      .insert(products)
      .values({ tenantId, name: input.name, sku: input.sku, unitPrice: input.unitPrice.toFixed(2) })
      .returning(),
  );
  return product;
}

export async function updateProduct(tenantId: string, input: z.infer<typeof updateProductInput>) {
  const [product] = await withTenantContext(tenantId, (tx) =>
    tx
      .update(products)
      .set({ name: input.name, sku: input.sku, unitPrice: input.unitPrice.toFixed(2), updatedAt: new Date() })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, input.id), isNull(products.deletedAt)))
      .returning(),
  );
  if (!product) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
  }
  return product;
}

export async function deleteProduct(tenantId: string, id: string) {
  const [product] = await withTenantContext(tenantId, (tx) =>
    tx
      .update(products)
      .set({ deletedAt: new Date() })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, id), isNull(products.deletedAt)))
      .returning(),
  );
  if (!product) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
  }
  return product;
}
