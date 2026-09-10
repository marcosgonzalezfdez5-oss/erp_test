import { cache } from "react";
import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import { users } from "@/lib/db/schema/user";
import { memberships, type MembershipRole } from "@/lib/db/schema/membership";
import { withTenantContext } from "@/lib/db/tenant-context";
import { seedDefaultPipeline } from "@/lib/services/pipeline";
import type { ActorContext } from "./actor";

/** The request-scoped {@link ActorContext} for the signed-in user. */
export type SessionContext = ActorContext;

/**
 * Maps a Clerk organization role to our internal `MembershipRole`. Clerk's
 * built-in `org:admin` → `admin`; a custom `org:sales_manager` role (created
 * in the Clerk dashboard) → `sales_manager`; everything else, including
 * Clerk's built-in `org:member`, → `sales_rep`.
 */
export function mapClerkOrgRole(orgRole: string | null | undefined): MembershipRole {
  if (orgRole === "org:admin") return "admin";
  if (orgRole === "org:sales_manager") return "sales_manager";
  return "sales_rep";
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

/**
 * Ensures a membership row exists and keeps its role in sync with Clerk.
 * Clerk is the source of truth for a member's role, so a role change in the
 * Clerk dashboard must propagate on the member's next request — an earlier
 * version returned the stored role unconditionally and never updated it.
 */
async function syncMembership(
  tenantId: string,
  userId: string,
  clerkRole: MembershipRole,
): Promise<MembershipRole> {
  return withTenantContext(tenantId, async (tx) => {
    const [row] = await tx
      .insert(memberships)
      .values({ tenantId, userId, role: clerkRole })
      .onConflictDoUpdate({
        target: [memberships.tenantId, memberships.userId],
        set: { role: clerkRole },
      })
      .returning({ role: memberships.role });

    return row.role;
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
  const role = await syncMembership(tenant.id, user.id, mapClerkOrgRole(orgRole));

  return { tenantId: tenant.id, userId: user.id, role };
});
