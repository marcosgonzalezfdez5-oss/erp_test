import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import * as accountService from "./account";

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

describe("account service", () => {
  it("creates, lists, updates, and soft-deletes an account", async () => {
    const tenant = await createTenant("a");

    const created = await accountService.createAccount(tenant.id, { name: "Acme Corp" });
    expect(created.name).toBe("Acme Corp");

    const listed = await accountService.listAccounts(tenant.id);
    expect(listed.map((a) => a.id)).toContain(created.id);

    const updated = await accountService.updateAccount(tenant.id, { id: created.id, name: "Acme Corp Inc" });
    expect(updated.name).toBe("Acme Corp Inc");

    await accountService.deleteAccount(tenant.id, created.id);
    const afterDelete = await accountService.listAccounts(tenant.id);
    expect(afterDelete.map((a) => a.id)).not.toContain(created.id);
  });

  it("rejects getAccount for an id belonging to another tenant", async () => {
    const tenantA = await createTenant("a");
    const tenantB = await createTenant("b");

    const account = await accountService.createAccount(tenantA.id, { name: "Tenant A Co" });

    await expect(accountService.getAccount(tenantB.id, account.id)).rejects.toThrow(TRPCError);
  });

  it("rejects updateAccount/deleteAccount for an id belonging to another tenant", async () => {
    const tenantA = await createTenant("a");
    const tenantB = await createTenant("b");

    const account = await accountService.createAccount(tenantA.id, { name: "Tenant A Co" });

    await expect(
      accountService.updateAccount(tenantB.id, { id: account.id, name: "Hijacked" }),
    ).rejects.toThrow(TRPCError);
    await expect(accountService.deleteAccount(tenantB.id, account.id)).rejects.toThrow(TRPCError);

    const stillThere = await accountService.getAccount(tenantA.id, account.id);
    expect(stillThere.name).toBe("Tenant A Co");
  });
});
