import { defineConfig, devices } from '@playwright/test';

// Smoke testlar alohida e2e bazasida (buxcrm_e2e) va alohida portlarda ishlaydi: dev ma'lumotga tegmaydi.
const E2E_DB = process.env.E2E_DATABASE_URL ?? 'postgres://buxcrm:buxcrm_dev_password@localhost:5432/buxcrm_e2e';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5174', trace: 'retain-on-failure', locale: 'uz-UZ', timezoneId: 'Asia/Tashkent' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run e2e:server',
      cwd: '../api',
      url: 'http://localhost:8090/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
      env: { DATABASE_URL: E2E_DB, PORT: '8090', NODE_ENV: 'development', SCHEDULER_ENABLED: 'true', TELEGRAM_BOT_TOKEN: '' },
    },
    {
      command: 'npx vite --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      env: { API_URL: 'http://localhost:8090' },
    },
  ],
});
