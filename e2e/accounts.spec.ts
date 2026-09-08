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

    await page.getByRole("link", { name: "Jane Doe" }).click();
    await expect(page.getByRole("heading", { name: "Jane Doe" })).toBeVisible();
    await expect(page.getByText("—")).toHaveCount(2);

    await page.getByRole("button", { name: "Edit" }).click();
    const contactEditDialog = page.getByRole("dialog");
    await contactEditDialog.getByLabel("Email").fill("jane@example.com");
    await contactEditDialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("jane@example.com")).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("heading", { name: "Acme Corp" })).toBeVisible();
    await expect(page.getByText("Jane Doe")).toHaveCount(0);
  } finally {
    await deleteTestUser(user.id);
  }
});

test("edit and delete accounts, and filter the list by search", async ({ page }) => {
  const { user, email } = await createTestUser();

  try {
    await signInAndCreateOrg(page, email, `E2E Org ${Date.now()}`);

    await page.goto("/accounts");
    await page.getByLabel("Name").fill("Acme Corp");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("link", { name: "Acme Corp" })).toBeVisible();

    await page.getByLabel("Name").fill("Globex Inc");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("link", { name: "Globex Inc" })).toBeVisible();

    await page.getByLabel("Search accounts…").fill("acme");
    await expect(page.getByRole("link", { name: "Acme Corp" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Globex Inc" })).toHaveCount(0);
    await page.getByLabel("Search accounts…").fill("");
    await expect(page.getByRole("link", { name: "Globex Inc" })).toBeVisible();

    await page.getByRole("button", { name: "Edit Acme Corp" }).click();
    const editDialog = page.getByRole("dialog");
    await editDialog.getByLabel("Name").fill("Acme Corporation");
    await editDialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("link", { name: "Acme Corporation" })).toBeVisible();

    await page.getByRole("button", { name: "Delete Globex Inc" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("link", { name: "Globex Inc" })).toHaveCount(0);
  } finally {
    await deleteTestUser(user.id);
  }
});
