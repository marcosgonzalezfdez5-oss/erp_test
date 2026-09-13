import { TRPCError } from "@trpc/server";
import { and, count, eq, ilike, isNull } from "drizzle-orm";
import { z } from "zod";
import { products, unitOfMeasureEnum } from "@/lib/db/schema/product";
import { taxTreatmentEnum } from "@/lib/db/schema/tax";
import { withTenantContext } from "@/lib/db/tenant-context";

export const PAGE_SIZE = 20;

const money = z.number().nonnegative().multipleOf(0.01);
const percent = z.number().min(0).max(100).multipleOf(0.01);
const quantity = z.number().nonnegative().multipleOf(0.001);

/** Fields shared by create and update — the ERP catalogue attributes (CLAUDE.md ERP plan). */
const productAttributes = {
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(100).optional(),
  unitPrice: money,
  unitOfMeasure: z.enum(unitOfMeasureEnum.enumValues).optional(),
  costPrice: money.nullish(),
  taxRatePercent: percent.nullish(),
  taxTreatment: z.enum(taxTreatmentEnum.enumValues).optional(),
  subjectToWithholding: z.boolean().optional(),
  tracksInventory: z.boolean().optional(),
  reorderPoint: quantity.nullish(),
};

export const createProductInput = z.object(productAttributes);

export const updateProductInput = z.object({ id: z.string().uuid(), ...productAttributes });

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

/** Maps validated numeric inputs to the fixed-scale strings the money/quantity columns expect. */
function attributeColumns(input: z.infer<typeof createProductInput> | z.infer<typeof updateProductInput>) {
  return {
    name: input.name,
    sku: input.sku ?? null,
    unitPrice: input.unitPrice.toFixed(2),
    ...(input.unitOfMeasure !== undefined ? { unitOfMeasure: input.unitOfMeasure } : {}),
    ...(input.costPrice !== undefined ? { costPrice: input.costPrice === null ? null : input.costPrice.toFixed(2) } : {}),
    ...(input.taxRatePercent !== undefined
      ? { taxRatePercent: input.taxRatePercent === null ? null : input.taxRatePercent.toFixed(2) }
      : {}),
    ...(input.taxTreatment !== undefined ? { taxTreatment: input.taxTreatment } : {}),
    ...(input.subjectToWithholding !== undefined ? { subjectToWithholding: input.subjectToWithholding } : {}),
    ...(input.tracksInventory !== undefined ? { tracksInventory: input.tracksInventory } : {}),
    ...(input.reorderPoint !== undefined
      ? { reorderPoint: input.reorderPoint === null ? null : input.reorderPoint.toFixed(3) }
      : {}),
  };
}

export async function createProduct(tenantId: string, input: z.infer<typeof createProductInput>) {
  const [product] = await withTenantContext(tenantId, (tx) =>
    tx.insert(products).values({ tenantId, ...attributeColumns(input) }).returning(),
  );
  return product;
}

export async function updateProduct(tenantId: string, input: z.infer<typeof updateProductInput>) {
  const [product] = await withTenantContext(tenantId, (tx) =>
    tx
      .update(products)
      .set({ ...attributeColumns(input), updatedAt: new Date() })
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
