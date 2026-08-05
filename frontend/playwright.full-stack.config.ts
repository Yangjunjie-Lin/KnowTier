import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/full-stack.spec.ts",
  outputDir: "test-results/full-stack",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 15 * 60_000,
  expect: {
    timeout: 60_000,
  },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report-full-stack" }],
  ],
  use: {
    baseURL:
      process.env.COGNIGRAPH_E2E_FRONTEND_URL ?? "http://127.0.0.1:18080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-full-stack",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
