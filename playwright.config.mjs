import {defineConfig, devices} from '@playwright/test';
import {browserEnv} from './scripts/browser-env.mjs';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', {open: 'never'}]],
  outputDir: 'test-results',
  use: {baseURL: browserEnv.APP_URL, trace: 'retain-on-failure', screenshot: 'only-on-failure'},
  projects: [
    {name: 'desktop', use: {...devices['Desktop Chrome']}},
    {name: 'phone', use: {...devices['Pixel 7']}},
  ],
  webServer: {
    command: 'node scripts/browser-server.mjs',
    url: `${browserEnv.APP_URL}/api/bootstrap`,
    reuseExistingServer: false,
    timeout: 120000,
    env: browserEnv,
  },
});
