import { defineConfig } from '@playwright/test';

// `npm run check` builds the site, serves it locally and runs tests/ against it
// at phone, tablet and desktop sizes. Runs on every push via GitHub Actions too.
const PORT = 4322;

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-report' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Lets the check use a browser that's already installed (set PW_CHROMIUM to its path).
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: 'phone-320', use: { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true } },
    { name: 'phone-390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'tablet-768', use: { viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true } },
    { name: 'desktop-1280', use: { viewport: { width: 1280, height: 900 } } },
  ],
  webServer: {
    command: `node tests/serve.mjs ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
});
