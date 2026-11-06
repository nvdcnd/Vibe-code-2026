/**
 * Header bảo mật đến từ `_headers` (Cloudflare Pages đọc tệp này lúc deploy;
 * `scripts/serve-static.mjs` mô phỏng đúng hành vi đó ở local).
 *
 * Vì sao phải test: một CSP sai không làm hỏng gì rõ ràng — nó chỉ âm thầm chặn
 * script/ảnh/iframe. Bộ test này khoá hai đầu:
 *   1. header thật sự được gắn và CSP được THI HÀNH (inline script bị chặn);
 *   2. CSP không quá tay: khung xem trước email (iframe srcdoc + inline style)
 *      vẫn hiển thị đúng.
 */
import { expect, test } from '@playwright/test';

import { generateEmails, goToPreview, openStudio } from './helpers.mjs';

test('trang chủ trả đủ header bảo mật', async ({ page }) => {
  const response = await page.goto('/');
  const headers = await response.allHeaders();

  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['content-security-policy']).toContain("script-src 'self'");
  expect(headers['content-security-policy']).toContain("object-src 'none'");
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['permissions-policy']).toContain('camera=()');
});

test('CSP chặn script nội tuyến chèn vào trang', async ({ page }) => {
  await page.goto('/');
  const violations = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });

  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__cspRan = true;';
    document.body.append(script);
  });

  expect(await page.evaluate(() => window.__cspRan)).toBeUndefined();
  await expect.poll(() => violations.length).toBeGreaterThan(0);
});

test('CSP chặn script từ miền ngoài không nằm trong allowlist', async ({ page }) => {
  await page.goto('/');
  const blocked = await page.evaluate(async () => {
    const script = document.createElement('script');
    script.src = 'https://example.com/evil.js';
    const failed = new Promise((resolve) => script.addEventListener('error', () => resolve(true)));
    document.body.append(script);
    return Promise.race([failed, new Promise((resolve) => setTimeout(() => resolve(false), 3000))]);
  });
  expect(blocked).toBe(true);
});

test('CSP vẫn cho iframe xem trước email dùng inline style', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);
  await goToPreview(page);

  // Bước 03 mặc định hiển thị chế độ văn bản; iframe HTML là chế độ thứ hai.
  await page.locator('.content-switch .view-btn[data-content="html"]').click();
  await expect(page.locator('#preview-html')).toBeVisible();

  const frame = page.frameLocator('#preview-html');
  await expect(frame.locator('h1')).toBeVisible();

  // buildEmailHTML() dựng layout hoàn toàn bằng style="" → nếu CSP thiếu
  // 'unsafe-inline' cho style-src thì các giá trị dưới đây sẽ về mặc định.
  const styles = await frame.locator('body').evaluate((body) => {
    const computed = getComputedStyle(body);
    return { padding: computed.padding, background: computed.backgroundColor };
  });
  expect(styles.padding).toBe('28px 12px');
  expect(styles.background).toBe('rgb(244, 245, 249)');
});

test('robots.txt công khai, chặn index /api và /media', async ({ request }) => {
  const response = await request.get('/robots.txt');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/plain');
  const body = await response.text();
  expect(body).toContain('User-agent: *');
  expect(body).toContain('Disallow: /api/');
  expect(body).toContain('Disallow: /media/');
});

test('_headers là tệp cấu hình, không bị phục vụ như asset', async ({ request }) => {
  expect((await request.get('/_headers')).status()).toBe(404);
});
