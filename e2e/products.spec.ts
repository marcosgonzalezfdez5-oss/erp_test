import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser, signInAndCreateOrg } from "./support/clerk-test-user";

test("create, edit, delete, and search products", async ({ page }) => {
  const { user, email } = await createTestUser();

  try {
    await signInAndCreateOrg(page, email, `E2E Org ${Date.now()}`);

    await page.goto("/products");
    await page.getByLabel("Name").fill("Widget");
    await page.getByLabel("Unit price").fill("10");
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page.getByText("Widget")).toBeVisible();

    await page.getByLabel("Name").fill("Gadget");
    await page.getByLabel("Unit price").fill("25.5");
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page.getByText("Gadget")).toBeVisible();

    await page.getByLabel("Search products…").fill("widg");
    await expect(page.getByText("Widget")).toBeVisible();
    await expect(page.getByText("Gadget")).toHaveCount(0);
    await page.getByLabel("Search products…").fill("");
    await expect(page.getByText("Gadget")).toBeVisible();

    await page.getByRole("button", { name: "Edit Widget" }).click();
    const editDialog = page.getByRole("dialog");
    await editDialog.getByLabel("Name").fill("Widget Pro");
    await editDialog.getByLabel("Unit price").fill("15");
    await editDialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Widget Pro")).toBeVisible();

    await page.getByRole("button", { name: "Delete Gadget" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Gadget")).toHaveCount(0);
  } finally {
    await deleteTestUser(user.id);
  }
});
