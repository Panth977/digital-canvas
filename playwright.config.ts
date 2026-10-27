import { defineConfig, devices } from '@playwright/test';

// DC_PORT lets several checkouts (git worktrees) run their own dev server side by side.
const port = Number(process.env.DC_PORT ?? 5181);

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: { command: 'npm run dev', url: `http://localhost:${port}`, reuseExistingServer: true, timeout: 60_000 },
});
