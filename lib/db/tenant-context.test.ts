import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { tenants } from "./schema/tenant";
import { users } from "./schema/user";
import { memberships } from "./schema/membership";
import { withTenantContext } from "./tenant-context";

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

afterEach(async () => {
  for (const tenantId of createdTenantIds.splice(0)) {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  }
  for (const userId of createdUserIds.splice(0)) {
    await db.delete(users).where(eq(users.id, userId));
  }
});

async function createTenantWithMembership(label: string) {
  const [tenant] = await db
    .insert(tenants)
    .values({ clerkOrgId: `org_${label}_${crypto.randomUUID()}`, name: `Tenant ${label}` })
    .returning();
  createdTenantIds.push(tenant.id);

  const [user] = await db
    .insert(users)
    .values({ clerkUserId: `user_${label}_${crypto.randomUUID()}`, email: `${label}@example.com` })
    .returning();
  createdUserIds.push(user.id);

  const [membership] = await withTenantContext(tenant.id, (tx) =>
    tx.insert(memberships).values({ tenantId: tenant.id, userId: user.id, role: "admin" }).returning(),
  );

  return { tenant, user, membership };
}

describe("tenant isolation (RLS)", () => {
  it("blocks reading another tenant's membership row, even by direct id lookup", async () => {
    const a = await createTenantWithMembership("a");
    const b = await createTenantWithMembership("b");

    const rows = await withTenantContext(a.tenant.id, (tx) =>
      tx.select().from(memberships).where(eq(memberships.id, b.membership.id)),
    );

    expect(rows).toHaveLength(0);
  });

  it("allows reading its own tenant's membership row", async () => {
    const a = await createTenantWithMembership("a");

    const rows = await withTenantContext(a.tenant.id, (tx) =>
      tx.select().from(memberships).where(eq(memberships.id, a.membership.id)),
    );

    expect(rows).toHaveLength(1);
  });
});
