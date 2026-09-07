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
    await page.getByLabel("Note").fill("Had a great call");
    await page.getByRole("button", { name: "Add activity" }).click();
    await expect(page.getByText("Had a great call")).toBeVisible();

    await page.getByLabel("Task title").fill("Send contract");
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(page.getByText("Send contract")).toBeVisible();

    await page.getByLabel("Complete Send contract").click();
    await expect(page.getByText("Send contract")).toHaveClass(/line-through/);
  } finally {
    await deleteTestUser(user.id);
  }
});
