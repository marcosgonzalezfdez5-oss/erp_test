import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser, signInAndCreateOrg } from "./support/clerk-test-user";

const MISSING_UUID = "00000000-0000-0000-0000-000000000000";

test("shows a not-found state for bad-URL and missing detail pages", async ({ page }) => {
  const { user, email } = await createTestUser();

  try {
    await signInAndCreateOrg(page, email, `E2E Org ${Date.now()}`);

    // Malformed id in the URL → the app's not-found page.
    await page.goto("/opportunities/not-a-uuid");
    await expect(page.getByRole("heading", { name: "Page not found" }).or(page.getByText("Page not found"))).toBeVisible();

    // Well-formed id that doesn't resolve → a per-entity "not found" state,
    // not the generic "couldn't load" error.
    for (const [path, label] of [
      ["/opportunities", "Opportunity not found"],
      ["/accounts", "Account not found"],
      ["/quotes", "Quote not found"],
      ["/orders", "Order not found"],
    ] as const) {
      await page.goto(`${path}/${MISSING_UUID}`);
      await expect(page.getByText(label)).toBeVisible();
    }
  } finally {
    await deleteTestUser(user.id);
  }
});
