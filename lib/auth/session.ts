import { cache } from "react";
import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import { users } from "@/lib/db/schema/user";
import { memberships, type MembershipRole } from "@/lib/db/schema/membership";
import { withTenantContext } from "@/lib/db/tenant-context";
import { seedDefaultPipeline } from "@/lib/services/pipeline";

export type SessionContext = {
  tenantId: string;
  userId: string;
  role: MembershipRole;
};

function mapClerkOrgRole(orgRole: string | null | undefined): MembershipRole {
  return orgRole === "org:admin" ? "admin" : "sales_rep";
}

async function findOrCreateTenant(clerkOrgId: string): Promise<{ id: string }> {
  const [existing] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.clerkOrgId, clerkOrgId));
  if (existing) return existing;

  const client = await clerkClient();
  const org = await client.organizations.getOrganization({ organizationId: clerkOrgId });

  const [created] = await db
    .insert(tenants)
    .values({ clerkOrgId, name: org.name })
    .onConflictDoUpdate({ target: tenants.clerkOrgId, set: { name: org.name } })
    .returning({ id: tenants.id });

  // Reached only on first sight of this org (the `existing` check above
  // returns early otherwise) — safe to seed the tenant's default pipeline.
  await seedDefaultPipeline(created.id);

  return created;
}

async function findOrCreateUser(clerkUserId: string): Promise<{ id: string }> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.clerkUserId, clerkUserId));
  if (existing) return existing;

  const clerkUser = await currentUser();
  const email = clerkUser?.primaryEmailAddress?.emailAddress ?? clerkUser?.emailAddresses[0]?.emailAddress ?? "";
  const name = clerkUser?.fullName ?? null;

  const [created] = await db
    .insert(users)
    .values({ clerkUserId, email, name })
    .onConflictDoUpdate({ target: users.clerkUserId, set: { email, name } })
    .returning({ id: users.id });

  return created;
}

async function findOrCreateMembership(
  tenantId: string,
  userId: string,
  defaultRole: MembershipRole,
): Promise<MembershipRole> {
  return withTenantContext(tenantId, async (tx) => {
    const [existing] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(eq(memberships.userId, userId));
    if (existing) return existing.role;

    const [created] = await tx
      .insert(memberships)
      .values({ tenantId, userId, role: defaultRole })
      .returning({ role: memberships.role });

    return created.role;
  });
}

/**
 * Resolves the current Clerk session into our internal tenant/user/role
 * context, syncing rows into `tenants`/`users`/`memberships` on first sight.
 * Returns null when there is no signed-in user or no active organization
 * (Clerk org == our Tenant — see CLAUDE.md §7).
 *
 * Wrapped in React's `cache()` so multiple Server Components in the same
 * request (e.g. the app shell resolving the role for nav + a page resolving
 * it again for its own use) share one resolution instead of racing — two
 * concurrent first-sight calls for a brand-new org would otherwise both see
 * "no tenant yet" and both run `seedDefaultPipeline`, duplicating stages.
 */
export const resolveSessionContext = cache(async (): Promise<SessionContext | null> => {
  const { userId: clerkUserId, orgId: clerkOrgId, orgRole } = await auth();
  if (!clerkUserId || !clerkOrgId) return null;

  const tenant = await findOrCreateTenant(clerkOrgId);
  const user = await findOrCreateUser(clerkUserId);
  const role = await findOrCreateMembership(tenant.id, user.id, mapClerkOrgRole(orgRole));

  return { tenantId: tenant.id, userId: user.id, role };
});
