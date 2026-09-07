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
    await backend.organizations.deleteOrganization(membership.organization.id);
  }
  await backend.users.deleteUser(userId);
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
