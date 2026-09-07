import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import * as accountService from "./account";
import * as contactService from "./contact";

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

describe("contact service", () => {
  it("creates, lists, updates, and soft-deletes a contact under an account", async () => {
    const tenant = await createTenant("a");
    const account = await accountService.createAccount(tenant.id, { name: "Acme Corp" });

    const created = await contactService.createContact(tenant.id, {
      accountId: account.id,
      firstName: "Jane",
      lastName: "Doe",
    });
    expect(created.firstName).toBe("Jane");

    const listed = await contactService.listContactsByAccount(tenant.id, account.id);
    expect(listed.map((c) => c.id)).toContain(created.id);

    const updated = await contactService.updateContact(tenant.id, {
      id: created.id,
      firstName: "Jane",
      lastName: "Smith",
    });
    expect(updated.lastName).toBe("Smith");

    await contactService.deleteContact(tenant.id, created.id);
    const afterDelete = await contactService.listContactsByAccount(tenant.id, account.id);
    expect(afterDelete.map((c) => c.id)).not.toContain(created.id);
  });

  it("rejects creating a contact under another tenant's account", async () => {
    const tenantA = await createTenant("a");
    const tenantB = await createTenant("b");
    const accountA = await accountService.createAccount(tenantA.id, { name: "Tenant A Co" });

    await expect(
      contactService.createContact(tenantB.id, {
        accountId: accountA.id,
        firstName: "Intruder",
        lastName: "Doe",
      }),
    ).rejects.toThrow(TRPCError);
  });

  it("rejects getContact/updateContact/deleteContact for an id belonging to another tenant", async () => {
    const tenantA = await createTenant("a");
    const tenantB = await createTenant("b");
    const accountA = await accountService.createAccount(tenantA.id, { name: "Tenant A Co" });
    const contact = await contactService.createContact(tenantA.id, {
      accountId: accountA.id,
      firstName: "Jane",
      lastName: "Doe",
    });

    await expect(contactService.getContact(tenantB.id, contact.id)).rejects.toThrow(TRPCError);
    await expect(
      contactService.updateContact(tenantB.id, { id: contact.id, firstName: "Hijacked", lastName: "Doe" }),
    ).rejects.toThrow(TRPCError);
    await expect(contactService.deleteContact(tenantB.id, contact.id)).rejects.toThrow(TRPCError);

    const stillThere = await contactService.getContact(tenantA.id, contact.id);
    expect(stillThere.firstName).toBe("Jane");
  });
});
