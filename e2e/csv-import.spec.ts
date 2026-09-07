import path from "node:path";
import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser, signInAndCreateOrg } from "./support/clerk-test-user";

const fixturePath = path.join(__dirname, "fixtures", "leads-sample.csv");

test("happy-path import of a small sample CSV, ending with the records visible in the leads list", async ({
  page,
}) => {
  const { user, email } = await createTestUser();

  try {
    await signInAndCreateOrg(page, email, `E2E Org ${Date.now()}`);

    await page.goto("/import");
    await page.getByLabel("What are you importing?").selectOption({ label: "Leads" });
    await page.locator('input[type="file"]').setInputFiles(fixturePath);

    await expect(page.getByText(/rows found/)).toBeVisible();

    await page.getByLabel("Map First to").selectOption({ label: "First name" });
    await page.getByLabel("Map Last to").selectOption({ label: "Last name" });
    await page.getByLabel("Map Email to").selectOption({ label: "Email" });

    await page.getByRole("button", { name: "Import 2 rows" }).click();
    await expect(page.getByTestId("import-summary")).toHaveText("Imported 2 of 2.");

    await page.getByRole("link", { name: "View leads" }).click();
    await expect(page.getByText("Jane Doe")).toBeVisible();
    await expect(page.getByText("John Smith")).toBeVisible();
  } finally {
    await deleteTestUser(user.id);
  }
});
