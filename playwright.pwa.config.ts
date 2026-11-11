import { defineConfig } from "@playwright/test";
export default defineConfig({
  outputDir: "test-results/pwa",
  testDir: "test/pwa",
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:4176", permissions: ["notifications"] },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4176 --strictPort",
    url: "http://127.0.0.1:4176",
    reuseExistingServer: false,
  },
});
