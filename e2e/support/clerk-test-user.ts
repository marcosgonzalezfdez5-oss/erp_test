import type { Page } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import { createClerkClient } from "@clerk/nextjs/server";

export const backend = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });

export async function createTestUser() {
  const email = `e2e_${Date.now()}_${Math.random().toString(36).slice(2)}+clerk_test@example.com`;
  const user = await backend.users.createUser({
    emailAddress: [email],
    password: "Sup3rSecret!2026",
    skipPasswordChecks: true,
  });
  return { user, email };
}

export async function deleteTestUser(userId: string) {
  const memberships = await backend.users.getOrganizationMembershipList({ userId });
  for (const membership of memberships.data) {
    await backend.organizations.deleteOrganization(membership.organization.id).catch(() => {});
  }
  await backend.users.deleteUser(userId).catch(() => {});
}

/** Deletes just the user, leaving any orgs (owned by another test user) intact. */
export async function deleteTestUserOnly(userId: string) {
  await backend.users.deleteUser(userId).catch(() => {});
}

/** The Clerk org id the user belongs to (they create exactly one in these tests). */
export async function getUserOrgId(userId: string): Promise<string> {
  const memberships = await backend.users.getOrganizationMembershipList({ userId });
  const orgId = memberships.data[0]?.organization.id;
  if (!orgId) throw new Error(`user ${userId} has no organization membership`);
  return orgId;
}

/**
 * Adds an existing test user to an org with a given Clerk org role.
 * `role` is a Clerk role key: "org:admin", "org:member" (→ sales_rep in our
 * mapping), or "org:sales_manager" (a custom role that must exist in the
 * Clerk instance — see lib/auth/session.ts mapClerkOrgRole).
 */
export async function addUserToOrg(organizationId: string, userId: string, role: string) {
  await backend.organizations.createOrganizationMembership({ organizationId, userId, role });
}

/** Changes an existing member's Clerk org role. */
export async function setOrgRole(organizationId: string, userId: string, role: string) {
  await backend.organizations.updateOrganizationMembership({ organizationId, userId, role });
}

/**
 * Signs in as a pre-provisioned test user and completes Clerk's hosted
 * "choose-organization" session task, landing back on /dashboard.
 * See CLAUDE.md §14 for why this uses the Backend API + @clerk/testing
 * instead of driving the hosted sign-up form (Turnstile bot protection).
 */
export async function signInAndCreateOrg(page: Page, email: string, orgName: string) {
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: email });

  await page.goto("/dashboard");
  await page.waitForURL(/sign-in\/tasks\/choose-organization/);
  await page.getByLabel("Name").fill(orgName);
  await page.getByRole("button", { name: "Continue" }).click();

  await page.waitForURL("http://localhost:3000/dashboard");
}

/**
 * Signs in as a user who is already a member of exactly one organization
 * (added via addUserToOrg). Completes the "choose-organization" task by
 * selecting that single org if Clerk presents it.
 */
export async function signInExistingMember(page: Page, email: string) {
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: email });

  await page.goto("/dashboard");
  await page.waitForURL(/dashboard|choose-organization/);

  if (page.url().includes("choose-organization")) {
    // The user belongs to one org — pick it from the list.
    await page.getByRole("button", { name: /continue|select|open/i }).first().click().catch(async () => {
      await page.getByRole("listitem").first().click();
    });
    await page.waitForURL("http://localhost:3000/dashboard");
  }
}
