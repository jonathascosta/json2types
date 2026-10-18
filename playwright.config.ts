import { defineConfig, devices } from '@playwright/test';

// End-to-end tests against the built site, as GitHub Pages serves it: the security policy is only
// in the build, so the dev server would test a page that never ships. Run `npm run build` first.
const PORT = 4173;
// A Chromium of the machine's own, when Playwright's isn't installed (CHROMIUM_PATH).
const executablePath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npx vite preview --port ${String(PORT)} --strictPort`,
    url: `http://127.0.0.1:${String(PORT)}/`,
    reuseExistingServer: !process.env.CI,
  },
});
