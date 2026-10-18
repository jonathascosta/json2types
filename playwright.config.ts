import { defineConfig, devices } from '@playwright/test';

// End-to-end tests against the built site, as GitHub Pages serves it: the security policy is only
// in the build, so the dev server would test a page that never ships. Run `npm run build` first.
// A port of its own, and never a server already running there: it could be serving another build.
const PORT = 4179;
// A Chromium of the machine's own, when Playwright's isn't installed (CHROMIUM_PATH).
const executablePath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // One retry on CI, where a shared machine can stall; a test that needed it is reported as flaky.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github'], ['html', { open: 'never' }]] : 'list',
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
    command: `npx vite preview --host 127.0.0.1 --port ${String(PORT)} --strictPort`,
    url: `http://127.0.0.1:${String(PORT)}/`,
    reuseExistingServer: false,
  },
});
