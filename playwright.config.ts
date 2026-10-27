import { defineConfig, devices } from '@playwright/test';

// DC_PORT lets several checkouts (git worktrees) run their own dev server side by side.
const port = Number(process.env.DC_PORT ?? 5181);

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', testIgnore: /mobile\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    // Phone layout with touch. Both run in Chromium: multi-finger gestures go through CDP touch events.
    { name: 'iphone-15', testMatch: /mobile\.spec\.ts/, use: { ...devices['iPhone 15'], defaultBrowserType: 'chromium', browserName: 'chromium' } },
    { name: 'pixel-8', testMatch: /mobile\.spec\.ts/, use: { ...devices['Pixel 8'] } },
  ],
  webServer: { command: 'npm run dev', url: `http://localhost:${port}`, reuseExistingServer: true, timeout: 60_000 },
});
