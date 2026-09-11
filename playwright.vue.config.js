import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e-vue',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: 'output/playwright-vue/test-results',
  snapshotPathTemplate: '{testDir}/../visual/baselines/{projectName}/{arg}{ext}',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'output/playwright-vue/report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev:vue -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium' }],
});

