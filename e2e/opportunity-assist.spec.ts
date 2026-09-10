import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser, signInAndCreateOrg } from "./support/clerk-test-user";

// Runs on the deterministic (no-AI) path: the summary and email fall back to
// templates, but generate/edit/persist all work — proving assist is useful
// without a live model (CLAUDE.md §9). Actual sending needs RESEND_API_KEY and
// is not exercised here.
test("generate a summary and draft a follow-up email on an opportunity", async ({ page }) => {
  const { user, email } = await createTestUser();

  try {
    await signInAndCreateOrg(page, email, `Assist Org ${Date.now()}`);

    await page.goto("/leads");
    await page.getByLabel("First name").fill("Jane");
    await page.getByLabel("Last name").fill("Doe");
    await page.getByRole("button", { name: "Create lead" }).click();
    await expect(page.getByText("Jane Doe")).toBeVisible();
    await page.getByRole("button", { name: "Convert to Opportunity" }).click();
    await expect(page.getByText("Converted")).toBeVisible();

    await page.goto("/opportunities");
    await page.getByTestId("stage-column-Qualification").getByRole("link", { name: "Jane Doe" }).click();

    await page.getByLabel("Note").fill("Intro call went well");
    await page.getByRole("button", { name: "Add activity" }).click();
    await expect(page.getByText("Intro call went well")).toBeVisible();

    // Summary
    await page.getByRole("button", { name: "Generate summary" }).click();
    await expect(page.getByText("Basic summary (AI unavailable)")).toBeVisible();

    // Follow-up email draft
    await page.getByRole("button", { name: "Draft follow-up email" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Subject")).toHaveValue(/Following up/);
    await dialog.getByLabel("Message").fill("Hi Jane, following up after our intro call. — Test");
    await dialog.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved")).toBeVisible();

    // The Send button is present but requires a recipient.
    await expect(dialog.getByRole("button", { name: "Send" })).toBeDisabled();
    await dialog.getByLabel("Send to").fill("jane@example.com");
    await expect(dialog.getByRole("button", { name: "Send" })).toBeEnabled();
  } finally {
    await deleteTestUser(user.id);
  }
});
