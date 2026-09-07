try {
  process.loadEnvFile(".env.local");
} catch {
  // optional, e.g. in CI where env vars are injected directly
}

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Every e2e test signs in a real user via Clerk's Backend API against a
  // shared dev instance, which has strict rate limits — running them in
  // parallel causes flaky failures under load. Serialize instead.
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
