import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser, signInAndCreateOrg } from "./support/clerk-test-user";

test("the suggestions inbox shows an empty state when nothing is pending", async ({ page }) => {
  const { user, email } = await createTestUser();

  try {
    await signInAndCreateOrg(page, email, `Suggestions Org ${Date.now()}`);

    await page.goto("/suggestions");
    await expect(page.getByRole("heading", { name: "Suggestions" })).toBeVisible();
    await expect(page.getByText("Nothing to review")).toBeVisible();

    await page.getByRole("button", { name: "History" }).click();
    await expect(page.getByText("No history yet")).toBeVisible();
  } finally {
    await deleteTestUser(user.id);
  }
});
