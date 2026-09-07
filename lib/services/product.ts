import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { products } from "@/lib/db/schema/product";
import { withTenantContext } from "@/lib/db/tenant-context";

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

export function listProducts(tenantId: string) {
  return withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(products)
      .where(and(eq(products.tenantId, tenantId), isNull(products.deletedAt)))
      .orderBy(products.name),
  );
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
