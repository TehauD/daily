import { defineConfig, devices } from '@playwright/test';

const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:8765',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath,
      // lets the demo spec reach the static host under a public-looking name
      args: ['--host-resolver-rules=MAP demo.thedaily.test 127.0.0.1'],
    },
  },
  webServer: [
    { command: `${python} test/e2e/harness.py`, url: 'http://127.0.0.1:8766/health', reuseExistingServer: false, timeout: 60_000 },
    { command: 'node ./bin/www', url: 'http://127.0.0.1:3123/', env: { PORT: '3123', NODE_ENV: 'production' }, reuseExistingServer: false, timeout: 60_000 },
  ],
});
