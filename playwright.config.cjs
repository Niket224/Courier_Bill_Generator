const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/e2e', timeout: 30000, workers: 1, retries: 0,
  reporter: 'list', outputDir: 'test-results',
  use: { baseURL: 'http://127.0.0.1:4187', serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'off' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 720 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true } }
  ],
  webServer: { command: 'node scripts/serve_mobile_app.mjs', url: 'http://127.0.0.1:4187',
    env: { PORT: '4187', NODE_ENV: 'test' }, reuseExistingServer: false }
});
