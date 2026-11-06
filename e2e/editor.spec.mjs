/**
 * Bước 02–03: biên tập, ảnh, HTML tuỳ chỉnh, xem trước, xuất file.
 * Tập trung vào những chỗ dễ hồi quy: đồng bộ hai chiều giữa state↔DOM, cờ
 * "HTML chưa khớp nội dung", và an toàn XSS khi người dùng dán HTML.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import {
  buildHtml,
  fillCampaign,
  generateEmails,
  goToPreview,
  openStudio,
  setCustomHtml,
} from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const BANNER = path.join(here, 'fixtures', 'banner.png');

async function uploadBanner(page) {
  await page.locator('#image-input').setInputFiles(BANNER);
  await expect(page.locator('#image-list .image-chip')).toHaveCount(1);
}

test('bộ đếm ký tự cập nhật ngay khi gõ', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);

  await page.locator('#edit-subject').fill('Mười hai ký tự'); // 14 ký tự
  await expect(page.locator('#subject-count')).toHaveText('14/140');

  await page.locator('#edit-body').fill('Nội dung ngắn');
  await expect(page.locator('#body-count')).toHaveText('13/2400');
});

test('sửa nội dung cập nhật preview của thẻ mẫu và bước 03', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);

  await page.locator('#edit-subject').fill('Tiêu đề mới toanh');
  await expect(page.locator('#variants-grid .variant-card').first()).toContainText('Tiêu đề mới toanh');

  await goToPreview(page);
  await expect(page.locator('#preview-subject')).toHaveText('Tiêu đề mới toanh');
});

test('ảnh tải lên: chip hiển thị, fallback base64 khi không có kho ảnh', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);
  await uploadBanner(page);

  const src = await page.locator('#image-list .image-chip img').first().getAttribute('src');
  expect(src.startsWith('data:image/png;base64,')).toBe(true);
  await expect(page.locator('#toast')).toContainText('Đã thêm ảnh');
});

test('ảnh bị từ chối khi sai định dạng và khi vượt 2 MB', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);

  await page.setInputFiles('#image-input', {
    name: 'ghi-chu.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('không phải ảnh'),
  });
  await expect(page.locator('#toast')).toContainText('1 ảnh bị bỏ qua');
  await expect(page.locator('#image-list .image-chip')).toHaveCount(0);

  await page.setInputFiles('#image-input', {
    name: 'qua-lon.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
  });
  await expect(page.locator('#toast')).toContainText('1 ảnh bị bỏ qua');
});

test('giới hạn tối đa 4 ảnh cho mỗi email', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);

  const files = Array.from({ length: 5 }, (_, index) => ({
    name: `banner-${index}.png`,
    mimeType: 'image/png',
    buffer: BANNER_BUFFER(),
  }));
  await page.setInputFiles('#image-input', files);

  await expect(page.locator('#image-list .image-chip')).toHaveCount(4);
  await expect(page.locator('#toast')).toContainText('Tối đa 4 ảnh mỗi email.');
});

test('xoá ảnh khỏi email', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);
  await uploadBanner(page);

  await page.locator('#image-list .image-remove').click();
  await expect(page.locator('#image-list .image-chip')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('Đã xoá ảnh.');
});

test('sinh HTML từ nội dung: có ảnh nhúng, thương hiệu và nút "về nội dung gốc"', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);
  await uploadBanner(page);
  await buildHtml(page);

  const html = await page.locator('#html-editor').inputValue();
  expect(html).toContain('<!doctype html>');
  expect(html).toContain('Luna Coffee');
  expect(html).toContain('data:image/png;base64,');
  expect(html).toContain('#574be8');

  await expect(page.locator('#clear-html-btn')).toBeVisible();
  await page.locator('#clear-html-btn').click();
  await expect(page.locator('#html-editor')).toHaveValue('');
  await expect(page.locator('#html-state')).toBeHidden();
});

test('sửa nội dung sau khi sinh HTML → đánh dấu "chưa khớp nội dung mới"', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);
  await buildHtml(page);

  await page.locator('#edit-body').fill('Nội dung đã đổi sau khi sinh HTML.');
  await expect(page.locator('#html-state')).toHaveText('HTML tuỳ chỉnh (chưa khớp nội dung mới)');
  await expect(page.locator('#html-state')).toHaveClass(/is-stale/);

  // Sinh lại thì cờ cảnh báo biến mất.
  await page.locator('#build-html-btn').click();
  await expect(page.locator('#html-state')).toHaveText('HTML tuỳ chỉnh đang dùng');
  await expect(page.locator('#html-state')).not.toHaveClass(/is-stale/);
});

test('HTML tuỳ chỉnh được dùng nguyên văn khi xem trước', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);
  await setCustomHtml(page, '<!doctype html><html><body><p id="custom">Nội dung tuỳ chỉnh</p></body></html>');

  await goToPreview(page);
  await page.locator('.content-switch .view-btn[data-content="html"]').click();
  await expect(page.locator('#preview-html')).toBeVisible();
  await expect(page.locator('#email-frame')).toBeHidden();

  const frame = page.frameLocator('#preview-html');
  await expect(frame.locator('#custom')).toHaveText('Nội dung tuỳ chỉnh');
});

test('iframe xem trước HTML bị sandbox, không chạy script', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);
  await setCustomHtml(page, '<html><body><script>parent.__xss = 1;</script>xin chào</body></html>');
  await goToPreview(page);
  await page.locator('.content-switch .view-btn[data-content="html"]').click();

  await expect(page.locator('#preview-html')).toHaveAttribute('sandbox', '');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('nội dung người dùng không thể chèn HTML vào preview hay file tải về (XSS)', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);

  const payload = '<img src=x onerror="window.__xss=1">"><script>window.__xss=2</script>';
  await page.locator('#edit-subject').fill(payload);
  await page.locator('#edit-cta').fill(payload);
  await buildHtml(page);

  const html = await page.locator('#html-editor').inputValue();
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img src=x');
  expect(html).toContain('&lt;img src=x');

  await goToPreview(page);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await expect(page.locator('#preview-subject')).toHaveText(payload);
});

test('tải email HTML: đúng tên file, nội dung là tài liệu HTML hoàn chỉnh', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);
  await goToPreview(page);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download-btn').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('mailcraft-email-1.html');
  const content = await readFile(await download.path(), 'utf8');
  expect(content).toContain('<!doctype html>');
  expect(content.trimEnd().endsWith('</html>')).toBe(true);
  await expect(page.locator('#toast')).toContainText('Đã tải xuống mẫu email HTML.');
});

test('sao chép nội dung vào clipboard theo định dạng văn bản thuần', async ({ page, context }) => {
  await openStudio(page);
  await generateEmails(page);
  const origin = new URL(page.url()).origin;
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });

  await goToPreview(page);
  await page.locator('#copy-btn').click();
  await expect(page.locator('#toast')).toContainText('Đã sao chép email vào bộ nhớ tạm.');

  // Windows: Chromium chuẩn hoá newline thành CRLF khi ghi clipboard.
  const clipboard = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
  expect(clipboard).toMatch(/^Tiêu đề: /);
  expect(clipboard).toContain('\n\nCTA: ');
});

test('chiến dịch mới: hỏi xác nhận, xoá sạch phiên và quay về bước 01', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);
  await uploadBanner(page);

  page.on('dialog', (dialog) => dialog.accept());
  await page.locator('#new-campaign').click();

  await expect(page.locator('#stage-1')).toBeVisible();
  await expect(page.locator('#brand')).toHaveValue('');
  await expect(page.locator('#image-list .image-chip')).toHaveCount(0);
  await expect(page.locator('#html-editor')).toHaveValue('');
  await expect(page.locator('#toast')).toContainText('Đã tạo chiến dịch mới.');
});

test('huỷ hộp thoại xác nhận thì giữ nguyên chiến dịch đang làm', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);

  page.on('dialog', (dialog) => dialog.dismiss());
  await page.locator('#new-campaign').click();

  await expect(page.locator('#stage-2')).toBeVisible();
  await expect(page.locator('#variants-grid .variant-card')).toHaveCount(3);
});

test('giữ nội dung khi đi tới bước 03 rồi quay lại biên tập', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);
  await page.locator('#edit-subject').fill('Giữ nguyên tiêu đề này');
  await goToPreview(page);
  await page.locator('#back-to-editor').click();

  await expect(page.locator('#edit-subject')).toHaveValue('Giữ nguyên tiêu đề này');
  await expect(page.locator('#stage-2')).toBeVisible();
});

test('ảnh gắn theo từng mẫu, không lẫn sang mẫu khác', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);
  await uploadBanner(page);

  await page.locator('#variants-grid .variant-card').nth(1).click();
  await expect(page.locator('#image-list .image-chip')).toHaveCount(0);

  await page.locator('#variants-grid .variant-card').nth(0).click();
  await expect(page.locator('#image-list .image-chip')).toHaveCount(1);
});

test('ngành hàng khác vẫn sinh đủ 3 mẫu (không phụ thuộc bảng thời gian)', async ({ page }) => {
  await openStudio(page);
  await fillCampaign(page, { industry: 'education', goal: 'retention' });
  await generateEmails(page);

  await expect(page.locator('#campaign-summary-industry')).toHaveText('Giáo dục & đào tạo');
  await expect(page.locator('#variants-grid .variant-card')).toHaveCount(3);
});

function BANNER_BUFFER() {
  // PNG 1×1 tối giản — đủ để trình duyệt coi là ảnh hợp lệ.
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+dQ0AAAAASUVORK5CYII=',
    'base64',
  );
}
