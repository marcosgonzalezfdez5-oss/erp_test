import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser, signInAndCreateOrg } from "./support/clerk-test-user";

test("create a lead, convert it, and see it appear on the pipeline", async ({ page }) => {
  const { user, email } = await createTestUser();

  try {
    await signInAndCreateOrg(page, email, `E2E Org ${Date.now()}`);

    await page.goto("/leads");
    await page.getByLabel("First name").fill("Jane");
    await page.getByLabel("Last name").fill("Doe");
    await page.getByRole("button", { name: "Create lead" }).click();

    await expect(page.getByText("Jane Doe")).toBeVisible();
    await page.getByRole("button", { name: "Convert to Opportunity" }).click();
    await expect(page.getByText("Converted")).toBeVisible();

    await page.goto("/opportunities");
    await expect(page.getByText("Jane Doe")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Qualification" })).toBeVisible();
  } finally {
    await deleteTestUser(user.id);
  }
});

test("deletes a lead and filters the list by search", async ({ page }) => {
  const { user, email } = await createTestUser();

  try {
    await signInAndCreateOrg(page, email, `E2E Org ${Date.now()}`);

    await page.goto("/leads");
    await page.getByLabel("First name").fill("Jane");
    await page.getByLabel("Last name").fill("Doe");
    await page.getByRole("button", { name: "Create lead" }).click();
    await expect(page.getByText("Jane Doe")).toBeVisible();

    await page.getByLabel("First name").fill("John");
    await page.getByLabel("Last name").fill("Smith");
    await page.getByRole("button", { name: "Create lead" }).click();
    await expect(page.getByText("John Smith")).toBeVisible();

    await page.getByLabel("Search leads…").fill("jane");
    await expect(page.getByText("Jane Doe")).toBeVisible();
    await expect(page.getByText("John Smith")).toHaveCount(0);
    await page.getByLabel("Search leads…").fill("");
    await expect(page.getByText("John Smith")).toBeVisible();

    await page.getByRole("button", { name: "Delete John Smith" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("John Smith")).toHaveCount(0);
  } finally {
    await deleteTestUser(user.id);
  }
});

test("undoes a lead conversion, and blocks it once the opportunity has real work", async ({ page }) => {
  const { user, email } = await createTestUser();

  try {
    await signInAndCreateOrg(page, email, `E2E Org ${Date.now()}`);

    await page.goto("/leads");
    await page.getByLabel("First name").fill("Jane");
    await page.getByLabel("Last name").fill("Doe");
    await page.getByRole("button", { name: "Create lead" }).click();
    await expect(page.getByText("Jane Doe")).toBeVisible();
    await page.getByRole("button", { name: "Convert to Opportunity" }).click();
    await expect(page.getByText("Converted")).toBeVisible();

    await page.getByRole("button", { name: "Undo conversion for Jane Doe" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Undo conversion" }).click();
    await expect(page.getByRole("button", { name: "Convert to Opportunity" })).toBeVisible();

    await page.goto("/opportunities");
    await expect(page.getByText("Jane Doe")).toHaveCount(0);

    await page.goto("/leads");
    await page.getByRole("button", { name: "Convert to Opportunity" }).click();
    await expect(page.getByText("Converted")).toBeVisible();

    await page.goto("/opportunities");
    await page.getByRole("link", { name: "Jane Doe" }).click();
    await page.getByLabel("Note").fill("Had a great call");
    await page.getByRole("button", { name: "Add activity" }).click();
    await expect(page.getByText("Had a great call")).toBeVisible();

    await page.goto("/leads");
    await page.getByRole("button", { name: "Undo conversion for Jane Doe" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Undo conversion" }).click();
    await expect(page.getByText(/already has activity, tasks, or quotes/)).toBeVisible();
    await expect(page.getByText("Converted", { exact: true })).toBeVisible();
  } finally {
    await deleteTestUser(user.id);
  }
});
