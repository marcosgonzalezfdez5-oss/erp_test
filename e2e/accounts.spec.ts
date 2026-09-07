import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser, signInAndCreateOrg } from "./support/clerk-test-user";

test("create an account and add a contact to it", async ({ page }) => {
  const { user, email } = await createTestUser();

  try {
    await signInAndCreateOrg(page, email, `E2E Org ${Date.now()}`);

    await page.goto("/accounts");
    await page.getByLabel("Name").fill("Acme Corp");
    await page.getByRole("button", { name: "Create account" }).click();

    const accountLink = page.getByRole("link", { name: "Acme Corp" });
    await expect(accountLink).toBeVisible();
    await accountLink.click();

    await expect(page.getByRole("heading", { name: "Acme Corp" })).toBeVisible();
    await page.getByLabel("First name").fill("Jane");
    await page.getByLabel("Last name").fill("Doe");
    await page.getByRole("button", { name: "Add contact" }).click();

    await expect(page.getByText("Jane Doe")).toBeVisible();
  } finally {
    await deleteTestUser(user.id);
  }
});
