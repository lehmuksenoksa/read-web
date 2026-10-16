import { defineConfig } from "@playwright/test";

// The smoke test (e2e/smoke.spec.ts): the built page served by `vite preview`, Chromium only, with a
// stand-in Dropbox. In CI the browser is installed by the workflow; here READ_CHROMIUM may point at one.
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173/read-web/",
    viewport: { width: 1440, height: 900 },
    ...(process.env.READ_CHROMIUM ? { launchOptions: { executablePath: process.env.READ_CHROMIUM } } : {}),
  },
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173/read-web/",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
