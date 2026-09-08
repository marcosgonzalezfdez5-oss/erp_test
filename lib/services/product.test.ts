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
    expect(listed.items.map((p) => p.id)).toContain(created.id);

    const updated = await productService.updateProduct(tenant.id, {
      id: created.id,
      name: "Widget Pro",
      unitPrice: 29.5,
    });
    expect(updated.name).toBe("Widget Pro");
    expect(updated.unitPrice).toBe("29.50");

    await productService.deleteProduct(tenant.id, created.id);
    const afterDelete = await productService.listProducts(tenant.id);
    expect(afterDelete.items.map((p) => p.id)).not.toContain(created.id);
  });

  it("filters by search and paginates results", async () => {
    const tenant = await createTenant("a");
    await productService.createProduct(tenant.id, { name: "Widget", unitPrice: 10 });
    await productService.createProduct(tenant.id, { name: "Gadget", unitPrice: 20 });

    const searched = await productService.listProducts(tenant.id, { page: 1, search: "widg" });
    expect(searched.items.map((p) => p.name)).toEqual(["Widget"]);
    expect(searched.total).toBe(1);

    const all = await productService.listProducts(tenant.id, { page: 1, search: "" });
    expect(all.total).toBe(2);
  });

  it("scopes search/pagination results to the requesting tenant", async () => {
    const tenantA = await createTenant("a");
    const tenantB = await createTenant("b");
    await productService.createProduct(tenantA.id, { name: "Tenant A Widget", unitPrice: 10 });
    await productService.createProduct(tenantB.id, { name: "Tenant B Widget", unitPrice: 10 });

    const listedByB = await productService.listProducts(tenantB.id, { page: 1, search: "" });
    expect(listedByB.items.map((p) => p.name)).toEqual(["Tenant B Widget"]);
    expect(listedByB.total).toBe(1);
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
