import path from "node:path";
import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser, signInAndCreateOrg } from "./support/clerk-test-user";

// Runs on the deterministic (no-AI) path: analyze proposes nothing for a
// fresh tenant, the user adds a stage by hand, turns it into a suggestion,
// and approves it — proving the manual path works end to end (CLAUDE.md §9).
test("guided setup turns a manually added stage into an approved pipeline stage", async ({ page }) => {
  const { user, email } = await createTestUser();

  try {
    await signInAndCreateOrg(page, email, `Setup Org ${Date.now()}`);

    await page.goto("/setup");
    await page.getByLabel("What does this data describe?").selectOption("account");
    await page
      .getByLabel("A sample export (CSV)")
      .setInputFiles(path.join(__dirname, "fixtures", "accounts-sample.csv"));
    await page.getByRole("button", { name: "Analyze" }).click();

    await expect(page.getByRole("heading", { name: "Pipeline stages to add" })).toBeVisible();

    await page.getByRole("button", { name: "Add stage" }).click();
    await page.getByLabel("Stage 1 name").fill("Site Survey");

    await page.getByRole("button", { name: /Create \d+ suggestions for review/ }).click();

    await page.waitForURL("**/suggestions");
    await expect(page.getByText('Add pipeline stage "Site Survey" (open)')).toBeVisible();

    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Nothing to review")).toBeVisible();

    await page.goto("/settings/pipeline");
    await expect(page.getByLabel("Stage name: Site Survey")).toHaveValue("Site Survey");
  } finally {
    await deleteTestUser(user.id);
  }
});
