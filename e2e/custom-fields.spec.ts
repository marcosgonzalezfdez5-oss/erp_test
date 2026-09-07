import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser, signInAndCreateOrg } from "./support/clerk-test-user";

test("define a custom field in settings, then fill it in and save it on a record", async ({ page }) => {
  const { user, email } = await createTestUser();

  try {
    await signInAndCreateOrg(page, email, `E2E Org ${Date.now()}`);

    await page.goto("/settings/custom-fields");
    await page.getByLabel("Field name").fill("Industry");
    await page.getByLabel("Field type").selectOption({ label: "Text" });
    await page.getByRole("button", { name: "Add field" }).click();
    await expect(page.getByText("Industry (text)")).toBeVisible();

    await page.goto("/accounts");
    await page.getByLabel("Name").fill("Acme Corp");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByRole("link", { name: "Acme Corp" }).click();

    await page.getByLabel("Industry").fill("Manufacturing");
    const saveButton = page.getByRole("button", { name: "Save" });
    await saveButton.click();
    // the button re-disables once the mutation resolves and the value round-trips
    // through the invalidated query — a reliable "save actually completed" signal
    await expect(saveButton).toBeDisabled();

    await page.reload();
    await expect(page.getByLabel("Industry")).toHaveValue("Manufacturing");
  } finally {
    await deleteTestUser(user.id);
  }
});
