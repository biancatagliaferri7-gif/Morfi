import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  outputDir: "test-results/e2e",
  testDir: "test/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4175",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"], viewport: { width: 360, height: 800 } },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4175 --strictPort",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "https://morfi-test.invalid",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_fixture_only",
      VITE_MORFI_ORDER_CHECKOUT_V2: "true",
    },
  },
});
