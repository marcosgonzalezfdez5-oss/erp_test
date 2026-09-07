import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser, signInAndCreateOrg } from "./support/clerk-test-user";

test("rename a pipeline stage in settings and see the change reflected", async ({ page }) => {
  const { user, email } = await createTestUser();

  try {
    await signInAndCreateOrg(page, email, `E2E Org ${Date.now()}`);

    await page.goto("/settings/pipeline");
    const stageInput = page.getByLabel("Stage name: Qualification");
    await expect(stageInput).toBeVisible();

    await stageInput.fill("Discovery");
    await page.locator("li", { has: stageInput }).getByRole("button", { name: "Save" }).click();

    await expect(page.getByLabel("Stage name: Discovery")).toHaveValue("Discovery");

    await page.reload();
    await expect(page.getByLabel("Stage name: Discovery")).toHaveValue("Discovery");
  } finally {
    await deleteTestUser(user.id);
  }
});
