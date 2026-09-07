import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import * as productService from "./product";

const createdTenantIds: string[] = [];

afterEach(async () => {
  for (const tenantId of createdTenantIds.splice(0)) {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  }
});

async function createTenant(label: string) {
  const [tenant] = await db
    .insert(tenants)
    .values({ clerkOrgId: `org_${label}_${crypto.randomUUID()}`, name: `Tenant ${label}` })
    .returning();
  createdTenantIds.push(tenant.id);
  return tenant;
}

describe("product service", () => {
  it("creates, lists, updates, and soft-deletes a product", async () => {
    const tenant = await createTenant("a");

    const created = await productService.createProduct(tenant.id, { name: "Widget", unitPrice: 19.99 });
    expect(created.name).toBe("Widget");
    expect(created.unitPrice).toBe("19.99");

    const listed = await productService.listProducts(tenant.id);
    expect(listed.map((p) => p.id)).toContain(created.id);

    const updated = await productService.updateProduct(tenant.id, {
      id: created.id,
      name: "Widget Pro",
      unitPrice: 29.5,
    });
    expect(updated.name).toBe("Widget Pro");
    expect(updated.unitPrice).toBe("29.50");

    await productService.deleteProduct(tenant.id, created.id);
    const afterDelete = await productService.listProducts(tenant.id);
    expect(afterDelete.map((p) => p.id)).not.toContain(created.id);
  });

  it("rejects getProduct for an id belonging to another tenant", async () => {
    const tenantA = await createTenant("a");
    const tenantB = await createTenant("b");

    const product = await productService.createProduct(tenantA.id, { name: "Tenant A Widget", unitPrice: 10 });

    await expect(productService.getProduct(tenantB.id, product.id)).rejects.toThrow(TRPCError);
  });

  it("rejects updateProduct/deleteProduct for an id belonging to another tenant", async () => {
    const tenantA = await createTenant("a");
    const tenantB = await createTenant("b");

    const product = await productService.createProduct(tenantA.id, { name: "Tenant A Widget", unitPrice: 10 });

    await expect(
      productService.updateProduct(tenantB.id, { id: product.id, name: "Hijacked", unitPrice: 1 }),
    ).rejects.toThrow(TRPCError);
    await expect(productService.deleteProduct(tenantB.id, product.id)).rejects.toThrow(TRPCError);

    const stillThere = await productService.getProduct(tenantA.id, product.id);
    expect(stillThere.name).toBe("Tenant A Widget");
  });
});
