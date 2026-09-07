import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser, signInAndCreateOrg } from "./support/clerk-test-user";

test("sign in, create an organization, and land on the dashboard", async ({ page }) => {
  const { user, email } = await createTestUser();

  try {
    await signInAndCreateOrg(page, email, `E2E Org ${Date.now()}`);
    await expect(page.getByTestId("session-role")).toHaveText("Signed in as: admin");
  } finally {
    await deleteTestUser(user.id);
  }
});
