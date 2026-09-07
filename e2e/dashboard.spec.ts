import path from "node:path";
import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser, signInAndCreateOrg } from "./support/clerk-test-user";

const fixturePath = path.join(__dirname, "fixtures", "leads-sample.csv");

test("full story: import leads, convert, move through the pipeline, build a quote, and see it on the dashboard", async ({
  page,
}) => {
  const { user, email } = await createTestUser();

  try {
    await signInAndCreateOrg(page, email, `E2E Org ${Date.now()}`);

    await page.goto("/products");
    await page.getByLabel("Name").fill("Widget");
    await page.getByLabel("Unit price").fill("10");
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page.getByText("Widget")).toBeVisible();

    await page.goto("/import");
    await page.getByLabel("What are you importing?").selectOption({ label: "Leads" });
    await page.locator('input[type="file"]').setInputFiles(fixturePath);
    await expect(page.getByText(/rows found/)).toBeVisible();
    await page.getByLabel("Map First to").selectOption({ label: "First name" });
    await page.getByLabel("Map Last to").selectOption({ label: "Last name" });
    await page.getByRole("button", { name: "Import 2 rows" }).click();
    await expect(page.getByTestId("import-summary")).toHaveText("Imported 2 of 2.");

    await page.goto("/leads");
    await page.getByRole("button", { name: "Convert to Opportunity" }).first().click();
    await expect(page.getByText("Converted")).toBeVisible();

    await page.goto("/opportunities");
    const negotiationColumn = page.getByTestId("stage-column-Negotiation");
    await page.getByLabel(/Move .* to stage/).selectOption({ label: "Negotiation" });
    await expect(negotiationColumn.getByRole("link")).toHaveCount(1);

    await negotiationColumn.getByRole("link").click();
    await page.getByLabel("Deal value").fill("5000");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByLabel("Deal value")).toHaveValue("5000.00");

    await page.getByRole("button", { name: "Create quote" }).click();
    await page.getByRole("link", { name: "Quote #1" }).click();
    await page.getByLabel("Product").selectOption({ label: "Widget ($10.00)" });
    await page.getByLabel("Quantity").fill("2");
    await page.getByRole("button", { name: "Add line item" }).click();
    await expect(page.getByTestId("quote-total")).toHaveText("$20.00");

    await page.goto("/dashboard");
    const negotiationRow = page.getByTestId("dashboard-stage-Negotiation");
    await expect(negotiationRow).toContainText("1");
    await expect(negotiationRow).toContainText("$5000.00");

    const qualificationRow = page.getByTestId("dashboard-stage-Qualification");
    await expect(qualificationRow).toContainText("0");
  } finally {
    await deleteTestUser(user.id);
  }
});
