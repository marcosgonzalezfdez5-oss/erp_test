import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser, signInAndCreateOrg } from "./support/clerk-test-user";

test("mark an opportunity Won and see the resulting order", async ({ page }) => {
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
    await page.getByLabel("Move Jane Doe to stage").selectOption({ label: "Won" });

    await page.getByRole("link", { name: "Jane Doe" }).click();
    await expect(page.getByTestId("order-banner")).toBeVisible();
    await expect(page.getByTestId("order-banner")).toContainText("Order created");

    await page.getByTestId("order-banner").click();
    await expect(page).toHaveURL(/\/orders\//);
    await expect(page.getByRole("heading", { name: "Order" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Jane Doe" })).toBeVisible();

    await page.getByRole("link", { name: "Back to opportunity" }).click();
    await expect(page.getByRole("heading", { name: "Jane Doe" })).toBeVisible();
  } finally {
    await deleteTestUser(user.id);
  }
});
