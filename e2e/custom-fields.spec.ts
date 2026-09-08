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

    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByLabel("Industry")).toHaveValue("");

    await page.goto("/settings/custom-fields");
    await page.getByRole("button", { name: "Rename Industry" }).click();
    const renameDialog = page.getByRole("dialog");
    await renameDialog.getByLabel("Field name").fill("Sector");
    await renameDialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Sector (text)")).toBeVisible();
  } finally {
    await deleteTestUser(user.id);
  }
});

test("flags a required custom field as unset and won't let it be cleared", async ({ page }) => {
  const { user, email } = await createTestUser();

  try {
    await signInAndCreateOrg(page, email, `E2E Org ${Date.now()}`);

    await page.goto("/settings/custom-fields");
    await page.getByLabel("Field name").fill("Industry");
    await page.getByLabel("Field type").selectOption({ label: "Text" });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Add field" }).click();
    await expect(page.getByText("Industry (text, required)")).toBeVisible();

    await page.goto("/accounts");
    await page.getByLabel("Name").fill("Acme Corp");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByRole("link", { name: "Acme Corp" }).click();
    await expect(page.getByRole("heading", { name: "Acme Corp" })).toBeVisible();

    // Unset: marked required, summary line shown, no Clear button, Save disabled.
    await expect(page.getByText("Required — not set.")).toBeVisible();
    await expect(page.getByText(/1 required field is not set: Industry/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

    // Fill it: hint + summary clear, still no Clear button for a required field.
    await page.getByLabel(/Industry/).fill("Manufacturing");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Required — not set.")).toHaveCount(0);
    await expect(page.getByText(/required field/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Clear" })).toHaveCount(0);

    await page.reload();
    await expect(page.getByLabel(/Industry/)).toHaveValue("Manufacturing");
  } finally {
    await deleteTestUser(user.id);
  }
});
