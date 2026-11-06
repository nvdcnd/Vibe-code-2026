/**
 * Cấu hình Playwright E2E cho MailCraft AI.
 *
 * Chạy trên server TĨNH (`scripts/serve-static.mjs`) — không có `/api` nên app
 * tự rơi về "Chế độ trải nghiệm". Riêng `ai-mode.spec.mjs` giả lập backend bằng
 * `page.route()` để kiểm thử cả nhánh AI mà không cần khoá Gemini thật.
 *
 * Browser: mặc định dùng Chromium do Playwright tải (`npx playwright install`),
 * nhờ vậy CI và máy dev chạy giống nhau. Máy nào muốn dùng Chrome cài sẵn thì
 * đặt biến môi trường `PW_CHANNEL=chrome`.
 *
 * Muốn test môi trường đầy đủ (Gemini + R2): `npm run dev` → http://127.0.0.1:8788/
 */
import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);
const PORT = Number(process.env.E2E_PORT || 8790);
const channel = process.env.PW_CHANNEL || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : 4,
  forbidOnly: isCI,
  reporter: isCI
    ? [['list'], ['github'], ['html', { open: 'never', outputFolder: 'e2e-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...(channel ? { channel } : {}),
    viewport: { width: 1360, height: 900 },
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node scripts/serve-static.mjs --port ${PORT} --root . --quiet`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 20_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
