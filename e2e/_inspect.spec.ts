import { test } from "@playwright/test";

test("inspect sign-up flow", async ({ page }) => {
  page.on("console", (msg) => console.log("CONSOLE:", msg.type(), msg.text()));
  page.on("response", (res) => {
    if (res.url().includes("clerk")) {
      console.log("RESPONSE:", res.status(), res.url());
    }
  });
  page.on("requestfailed", (req) => console.log("REQFAILED:", req.url(), req.failure()?.errorText));

  await page.goto("/sign-up");
  await page.waitForLoadState("networkidle");

  await page.getByPlaceholder("Enter your email address").fill(`e2e_${Date.now()}+clerk_test@example.com`);
  await page.getByPlaceholder("Create a password").fill("Sup3rSecret!2026");

  const continueButton = page.getByRole("button", { name: "Continue", exact: true });
  console.log("button disabled?", await continueButton.isDisabled());

  await continueButton.click();
  await page.waitForTimeout(2000);
  console.log("button disabled after click?", await continueButton.isDisabled().catch(() => "n/a"));
  await page.waitForTimeout(6000);

  console.log("URL after continue:", page.url());
  const bodyText = await page.locator("body").innerText();
  console.log("BODY TEXT:", bodyText.slice(0, 500));
});
