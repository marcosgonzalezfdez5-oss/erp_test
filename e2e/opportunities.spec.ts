import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser, signInAndCreateOrg } from "./support/clerk-test-user";

test("move an opportunity across pipeline stages and add an activity and task", async ({ page }) => {
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
    const qualificationColumn = page.getByTestId("stage-column-Qualification");
    const negotiationColumn = page.getByTestId("stage-column-Negotiation");
    await expect(qualificationColumn.getByText("Jane Doe")).toBeVisible();

    await page.getByLabel("Move Jane Doe to stage").selectOption({ label: "Negotiation" });

    await expect(negotiationColumn.getByText("Jane Doe")).toBeVisible();
    await expect(qualificationColumn.getByText("Jane Doe")).toHaveCount(0);

    await negotiationColumn.getByRole("link", { name: "Jane Doe" }).click();

    // Add buttons stay disabled until their field has content (no blank/dupe rows).
    await expect(page.getByRole("button", { name: "Add activity" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Add task" })).toBeDisabled();

    await page.getByLabel("Note").fill("Had a great call");
    await expect(page.getByRole("button", { name: "Add activity" })).toBeEnabled();
    await page.getByRole("button", { name: "Add activity" }).click();
    await expect(page.getByText("Had a great call")).toBeVisible();

    await page.getByLabel("Task title").fill("Send contract");
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(page.getByText("Send contract")).toBeVisible();

    await page.getByLabel("Complete Send contract").click();
    await expect(page.getByText("Send contract")).toHaveClass(/line-through/);

    await page.getByRole("button", { name: "Edit" }).click();
    const editDialog = page.getByRole("dialog");
    await editDialog.getByLabel("Name").fill("Jane Doe — Renewal");
    await editDialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: "Jane Doe — Renewal" })).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL(/\/opportunities$/);
    await expect(page.getByText("Jane Doe")).toHaveCount(0);
  } finally {
    await deleteTestUser(user.id);
  }
});

test("filters the opportunities board by search", async ({ page }) => {
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

    await page.getByLabel("First name").fill("John");
    await page.getByLabel("Last name").fill("Smith");
    await page.getByRole("button", { name: "Create lead" }).click();
    await expect(page.getByText("John Smith")).toBeVisible();
    await page.getByRole("button", { name: "Convert to Opportunity" }).click();
    await expect(page.getByText("Converted")).toHaveCount(2);

    await page.goto("/opportunities");
    await expect(page.getByText("Jane Doe")).toBeVisible();
    await expect(page.getByText("John Smith")).toBeVisible();

    await page.getByLabel("Search opportunities…").fill("jane");
    await expect(page.getByText("Jane Doe")).toBeVisible();
    await expect(page.getByText("John Smith")).toHaveCount(0);
  } finally {
    await deleteTestUser(user.id);
  }
});
