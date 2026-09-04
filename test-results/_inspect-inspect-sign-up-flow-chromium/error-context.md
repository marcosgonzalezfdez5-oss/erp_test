# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: _inspect.spec.ts >> inspect sign-up flow
- Location: e2e\_inspect.spec.ts:3:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.waitForTimeout: Target page, context or browser has been closed
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e4]:
    - generic [ref=e7]:
      - heading "Create your account" [level=1] [ref=e8]
      - paragraph [ref=e9]: Welcome! Please fill in the details to get started.
    - generic [ref=e13]:
      - generic [ref=e14]:
        - generic [ref=e15]: Already have an account?
        - link "Sign in" [ref=e16] [cursor=pointer]:
          - /url: http://localhost:3000/sign-in
      - generic [ref=e18]:
        - generic [ref=e20]:
          - paragraph [ref=e21]: Secured by
          - link "Clerk logo" [ref=e22] [cursor=pointer]:
            - /url: https://go.clerk.com/components
        - paragraph [ref=e28]: Development mode
  - button "Open Next.js Dev Tools" [ref=e34] [cursor=pointer]
  - alert [ref=e38]
```

# Test source

```ts
  1  | import { test } from "@playwright/test";
  2  | 
  3  | test("inspect sign-up flow", async ({ page }) => {
  4  |   page.on("console", (msg) => console.log("CONSOLE:", msg.type(), msg.text()));
  5  |   page.on("response", (res) => {
  6  |     if (res.url().includes("clerk")) {
  7  |       console.log("RESPONSE:", res.status(), res.url());
  8  |     }
  9  |   });
  10 |   page.on("requestfailed", (req) => console.log("REQFAILED:", req.url(), req.failure()?.errorText));
  11 | 
  12 |   await page.goto("/sign-up");
  13 |   await page.waitForLoadState("networkidle");
  14 | 
  15 |   await page.getByPlaceholder("Enter your email address").fill(`e2e_${Date.now()}+clerk_test@example.com`);
  16 |   await page.getByPlaceholder("Create a password").fill("Sup3rSecret!2026");
  17 | 
  18 |   const continueButton = page.getByRole("button", { name: "Continue", exact: true });
  19 |   console.log("button disabled?", await continueButton.isDisabled());
  20 | 
  21 |   await continueButton.click();
  22 |   await page.waitForTimeout(2000);
  23 |   console.log("button disabled after click?", await continueButton.isDisabled().catch(() => "n/a"));
> 24 |   await page.waitForTimeout(6000);
     |              ^ Error: page.waitForTimeout: Target page, context or browser has been closed
  25 | 
  26 |   console.log("URL after continue:", page.url());
  27 |   const bodyText = await page.locator("body").innerText();
  28 |   console.log("BODY TEXT:", bodyText.slice(0, 500));
  29 | });
  30 | 
```