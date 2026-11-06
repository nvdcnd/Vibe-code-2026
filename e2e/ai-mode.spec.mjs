/**
 * Nhánh AI thật được kiểm thử bằng cách giả lập `/api/*` qua `page.route()`.
 *
 * Nhờ vậy CI chạy được toàn bộ luồng AI (không cần khoá Gemini, không tốn quota,
 * không phụ thuộc mạng) và vẫn xác minh được những hành vi quan trọng:
 *  - nhãn trạng thái đổi sang "AI đã cấu hình",
 *  - dữ liệu gửi lên đúng hợp đồng,
 *  - lỗi/timeout/dữ liệu hỏng đều rơi về toast tiếng Việt và KHÔNG mất nội dung,
 *  - khoá ảnh R2 → ảnh dùng URL thay vì base64.
 */
import { expect, test } from '@playwright/test';

import { buildHtml, goToPreview, openStudio } from './helpers.mjs';

const AI_EMAILS = [
  { subject: 'Ưu đãi AI 1', body: 'Nội dung AI 1', cta: 'Xem 1' },
  { subject: 'Ưu đãi AI 2', body: 'Nội dung AI 2', cta: 'Xem 2' },
  { subject: 'Ưu đãi AI 3', body: 'Nội dung AI 3', cta: 'Xem 3' },
];

async function mockStatus(page, handler) {
  await page.route('**/api/status', handler);
}

async function openStudioInAiMode(page, extraRoutes = {}) {
  await mockStatus(page, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'ai' }) }),
  );
  for (const [pattern, handler] of Object.entries(extraRoutes)) {
    await page.route(pattern, handler);
  }
  await openStudio(page);
  await expect(page.locator('#engine-label')).toHaveText('AI đã cấu hình');
  return page;
}

function jsonFulfill(data, status = 200) {
  return (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
}

test('có /api/status mode=ai → nhãn "AI đã cấu hình" (dot xanh, không phải demo)', async ({ page }) => {
  await openStudioInAiMode(page);

  await expect(page.locator('#engine-status')).toHaveClass(/is-ai/);
  await expect(page.locator('#engine-status')).not.toHaveClass(/is-demo/);
});

test('/api/status lỗi 500 → tự rơi về chế độ trải nghiệm thay vì treo', async ({ page }) => {
  await mockStatus(page, (route) => route.fulfill({ status: 500, body: 'boom' }));
  await page.goto('/#studio');

  await expect(page.locator('#engine-label')).toHaveText('Chế độ trải nghiệm');
});

test('/api/status trả JSON rác → vẫn giữ chế độ trải nghiệm', async ({ page }) => {
  await mockStatus(page, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"mode":"???"}' }),
  );
  await page.goto('/#studio');

  await expect(page.locator('#engine-label')).toHaveText('Chế độ trải nghiệm');
});

test('tạo email bằng AI: gửi đúng payload và hiển thị nội dung trả về', async ({ page }) => {
  let sentBody;
  await openStudioInAiMode(page, {
    '**/api/generate': (route) => {
      sentBody = route.request().postDataJSON();
      return jsonFulfill({ emails: AI_EMAILS })(route);
    },
  });

  await page.locator('#generate-btn').click();
  await expect(page.locator('#stage-2')).toBeVisible();

  await expect(page.locator('#generation-source')).toContainText('Nội dung do AI tạo');
  await expect(page.locator('#generation-source')).not.toHaveClass(/is-demo/);
  const subjects = await page.locator('#variants-grid .variant-card strong').allTextContents();
  expect(subjects).toEqual(['Ưu đãi AI 1', 'Ưu đãi AI 2', 'Ưu đãi AI 3']);

  expect(sentBody).toMatchObject({
    brand: 'Luna Coffee',
    goal: 'promotion',
    industry: 'food',
    audience: 'Người yêu cà phê',
  });
  expect(typeof sentBody.offer).toBe('string');
});

test('AI trả tiêu đề quá dài → bị cắt về 140 ký tự (chốt chặn phía client)', async ({ page }) => {
  await openStudioInAiMode(page, {
    '**/api/generate': jsonFulfill({
      emails: AI_EMAILS.map((mail) => ({ ...mail, subject: 'x'.repeat(300) })),
    }),
  });

  await page.locator('#generate-btn').click();
  await expect(page.locator('#stage-2')).toBeVisible();
  expect((await page.locator('#edit-subject').inputValue()).length).toBe(140);
});

test('AI báo hết hạn mức → toast đúng thông điệp, không nhảy bước', async ({ page }) => {
  await openStudioInAiMode(page, {
    '**/api/generate': jsonFulfill(
      { error: 'Bạn đã dùng hết lượt hôm nay. Vui lòng quay lại vào ngày mai.' },
      429,
    ),
  });

  await page.locator('#generate-btn').click();

  await expect(page.locator('#toast')).toContainText('Bạn đã dùng hết lượt hôm nay.');
  await expect(page.locator('#toast')).toHaveClass(/error/);
  await expect(page.locator('#stage-1')).toBeVisible();
  await expect(page.locator('#stage-2')).toBeHidden();
  // Nút phải được mở khoá lại để người dùng thử lại.
  await expect(page.locator('#generate-btn')).toBeEnabled();
  await expect(page.locator('#generate-text')).toHaveText('Tạo 3 mẫu email');
});

test('AI trả thiếu mẫu → thông điệp lỗi rõ ràng, giữ nguyên bước 01', async ({ page }) => {
  await openStudioInAiMode(page, {
    '**/api/generate': jsonFulfill({ emails: AI_EMAILS.slice(0, 2) }),
  });

  await page.locator('#generate-btn').click();
  await expect(page.locator('#toast')).toContainText('AI chưa trả về đủ 3 mẫu email.');
  await expect(page.locator('#stage-1')).toBeVisible();
});

test('AI trả JSON không phải JSON → lỗi thân thiện thay vì crash', async ({ page }) => {
  await openStudioInAiMode(page, {
    '**/api/generate': (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: 'not-json' }),
  });

  await page.locator('#generate-btn').click();
  await expect(page.locator('#toast')).toContainText('Máy chủ trả về dữ liệu không hợp lệ.');
  await expect(page.locator('#stage-1')).toBeVisible();
});

test('viết lại bằng AI: giữ CTA URL hiện tại, đổi nội dung theo kết quả trả về', async ({ page }) => {
  let sent;
  await openStudioInAiMode(page, {
    '**/api/generate': jsonFulfill({ emails: AI_EMAILS }),
    '**/api/rewrite': (route) => {
      sent = route.request().postDataJSON();
      return jsonFulfill({
        email: { subject: 'Chủ đề AI viết lại', body: 'Thân email AI viết lại.', cta: 'CTA mới' },
      })(route);
    },
  });

  await page.locator('#generate-btn').click();
  await expect(page.locator('#stage-2')).toBeVisible();
  await page.locator('#edit-url').fill('https://lunacoffee.vn/uu-dai');
  await page.locator('input[name="tone"][value="fun"]').check();
  await page.locator('#rewrite-btn').click();

  await expect(page.locator('#edit-subject')).toHaveValue('Chủ đề AI viết lại');
  await expect(page.locator('#edit-body')).toHaveValue('Thân email AI viết lại.');
  await expect(page.locator('#edit-cta')).toHaveValue('CTA mới');
  await expect(page.locator('#edit-url')).toHaveValue('https://lunacoffee.vn/uu-dai');
  expect(sent.tone).toBe('fun');
  expect(sent.email.subject).toBe('Ưu đãi AI 1');
});

test('viết lại lỗi → toast lỗi, nội dung cũ không bị mất', async ({ page }) => {
  await openStudioInAiMode(page, {
    '**/api/generate': jsonFulfill({ emails: AI_EMAILS }),
    '**/api/rewrite': jsonFulfill({ error: 'Dịch vụ AI trả lỗi. Vui lòng thử lại sau ít phút.' }, 502),
  });

  await page.locator('#generate-btn').click();
  await expect(page.locator('#stage-2')).toBeVisible();
  await page.locator('#rewrite-btn').click();

  await expect(page.locator('#toast')).toContainText('Dịch vụ AI trả lỗi.');
  await expect(page.locator('#edit-subject')).toHaveValue('Ưu đãi AI 1');
  await expect(page.locator('#rewrite-btn')).toBeEnabled();
});

test('có kho ảnh R2: ảnh dùng URL tuyệt đối trong file HTML xuất ra', async ({ page }) => {
  await openStudioInAiMode(page, {
    '**/api/generate': jsonFulfill({ emails: AI_EMAILS }),
    '**/api/upload': jsonFulfill({ url: '/media/uploads/abc-123.png' }),
  });

  await page.locator('#generate-btn').click();
  await expect(page.locator('#stage-2')).toBeVisible();
  await page.locator('#image-input').setInputFiles({
    name: 'banner.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+dQ0AAAAASUVORK5CYII=',
      'base64',
    ),
  });

  const chip = page.locator('#image-list .image-chip');
  await expect(chip).toHaveCount(1);
  await expect(chip.locator('img')).toHaveAttribute('src', '/media/uploads/abc-123.png');
  await expect(chip.locator('.image-hosted')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Đã thêm ảnh (lưu trên kho ảnh');

  await buildHtml(page);
  const html = await page.locator('#html-editor').inputValue();
  expect(html).toContain('/media/uploads/abc-123.png');
  expect(html).toMatch(/src="https?:\/\/[^"]+\/media\/uploads\/abc-123\.png"/);
  expect(html).not.toContain('data:image');
});

test('AI mode vẫn dựng preview bước 03 và giờ gửi theo ngành', async ({ page }) => {
  await openStudioInAiMode(page, { '**/api/generate': jsonFulfill({ emails: AI_EMAILS }) });

  await page.locator('#generate-btn').click();
  await expect(page.locator('#stage-2')).toBeVisible();
  await goToPreview(page);

  await expect(page.locator('#preview-subject')).toHaveText('Ưu đãi AI 1');
  await expect(page.locator('#timing-category')).toHaveText('Ẩm thực & đồ uống');
});
