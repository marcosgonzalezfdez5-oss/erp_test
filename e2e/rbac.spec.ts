import { test, expect } from "@playwright/test";
import {
  addUserToOrg,
  createTestUser,
  deleteTestUser,
  deleteTestUserOnly,
  getUserOrgId,
  signInAndCreateOrg,
  signInExistingMember,
} from "./support/clerk-test-user";

test("an admin can configure the pipeline; a sales_rep cannot", async ({ page }) => {
  const admin = await createTestUser();
  const rep = await createTestUser();

  try {
    await signInAndCreateOrg(page, admin.email, `RBAC Org ${Date.now()}`);
    const orgId = await getUserOrgId(admin.user.id);
    await addUserToOrg(orgId, rep.user.id, "org:member");

    // Admin: settings page is usable.
    await page.goto("/settings/pipeline");
    await expect(page.getByLabel("Stage name: Qualification")).toBeVisible();

    // Sales rep: settings page shows the access-denied state, no add-stage form.
    await page.context().clearCookies();
    await signInExistingMember(page, rep.email);
    await page.goto("/settings/pipeline");
    await expect(page.getByText("Manager access required")).toBeVisible();
    await expect(page.getByLabel("Stage name: Qualification")).toHaveCount(0);

    // Sales rep: a direct tRPC mutation is rejected server-side (403 FORBIDDEN).
    const res = await page.request.post("/api/trpc/pipeline.create?batch=1", {
      data: { "0": { json: { name: "Sneaky Stage", kind: "open" } } },
      headers: { "content-type": "application/json" },
    });
    expect(res.status()).toBe(403);

    // Sales rep can still do ordinary sales work — create an account.
    await page.goto("/accounts");
    await page.getByLabel("Name").fill("Rep's Account");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Rep's Account")).toBeVisible();
  } finally {
    await deleteTestUserOnly(rep.user.id);
    await deleteTestUser(admin.user.id);
  }
});
