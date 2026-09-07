import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser, signInAndCreateOrg } from "./support/clerk-test-user";

test("build a quote from an opportunity end to end and see the correct total", async ({ page }) => {
  const { user, email } = await createTestUser();

  try {
    await signInAndCreateOrg(page, email, `E2E Org ${Date.now()}`);

    await page.goto("/products");
    await page.getByLabel("Name").fill("Widget");
    await page.getByLabel("Unit price").fill("10");
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page.getByText("Widget")).toBeVisible();

    await page.getByLabel("Name").fill("Gadget");
    await page.getByLabel("Unit price").fill("25.50");
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page.getByText("Gadget")).toBeVisible();

    await page.goto("/leads");
    await page.getByLabel("First name").fill("Jane");
    await page.getByLabel("Last name").fill("Doe");
    await page.getByRole("button", { name: "Create lead" }).click();
    await expect(page.getByText("Jane Doe")).toBeVisible();
    await page.getByRole("button", { name: "Convert to Opportunity" }).click();
    await expect(page.getByText("Converted")).toBeVisible();

    await page.goto("/opportunities");
    await page.getByRole("link", { name: "Jane Doe" }).click();

    await page.getByRole("button", { name: "Create quote" }).click();
    await page.getByRole("link", { name: "Quote #1" }).click();

    await page.getByLabel("Product").selectOption({ label: "Widget ($10.00)" });
    await page.getByLabel("Quantity").fill("2");
    await page.getByRole("button", { name: "Add line item" }).click();
    await expect(page.getByTestId("quote-total")).toHaveText("$20.00");

    await page.getByLabel("Product").selectOption({ label: "Gadget ($25.50)" });
    await page.getByLabel("Quantity").fill("1");
    await page.getByRole("button", { name: "Add line item" }).click();
    await expect(page.getByTestId("quote-total")).toHaveText("$45.50");

    await page.getByRole("button", { name: "Remove Widget" }).click();
    await expect(page.getByTestId("quote-total")).toHaveText("$25.50");
  } finally {
    await deleteTestUser(user.id);
  }
});
