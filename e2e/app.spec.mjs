/**
 * Luồng chính ở chế độ demo (không có backend): từ form chiến dịch → 3 mẫu →
 * biên tập → xem trước. Đây là đường đi mặc định của người dùng khi chưa cấu
 * hình Gemini, nên nó phải luôn xanh.
 */
import { expect, test } from '@playwright/test';

import { fillCampaign, generateEmails, goToPreview, openStudio } from './helpers.mjs';

test('form mặc định điền sẵn chiến dịch mẫu và tóm tắt khớp dữ liệu', async ({ page }) => {
  await openStudio(page);

  await expect(page.locator('#brand')).toHaveValue('Luna Coffee');
  await expect(page.locator('#offer')).toHaveValue('Giảm 20% cho cà phê hạt rang đến hết Chủ nhật.');
  await expect(page.locator('#brief-brand')).toHaveText('Luna Coffee');
  await expect(page.locator('#brief-goal')).toHaveText('Khuyến mãi');
  await expect(page.locator('#brief-industry')).toHaveText('Ẩm thực & đồ uống');
  await expect(page.locator('#offer-count')).toHaveText(/\/420$/);
});

test('không có /api → nhãn "Chế độ trải nghiệm" (fallback minh bạch, không giả AI)', async ({ page }) => {
  await openStudio(page);

  await expect(page.locator('#engine-label')).toHaveText('Chế độ trải nghiệm');
  await expect(page.locator('#engine-status')).toHaveClass(/is-demo/);
});

test('tạo email: 3 mẫu khác nhau, mở bước 02 với nội dung đã chọn', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);

  await expect(page.locator('#stage-1')).toBeHidden();
  await expect(page.locator('#generation-source')).toContainText('Nội dung mẫu để trải nghiệm');
  await expect(page.locator('#generation-source')).toHaveClass(/is-demo/);
  await expect(page.locator('#campaign-summary-brand')).toHaveText('Luna Coffee');
  // Ba tiêu đề phải khác nhau — nếu không thì "3 hướng nội dung" là vô nghĩa.
  const subjects = await page.locator('#variants-grid .variant-card strong').allTextContents();
  expect(new Set(subjects).size).toBe(3);

  const subject = await page.locator('#edit-subject').inputValue();
  expect(subject.length).toBeGreaterThan(0);
  await expect(page.locator('#subject-count')).toHaveText(`${subject.length}/140`);
  await expect(page.locator('#selected-tag')).toContainText('MẪU 01');
  await expect(page.locator('#toast')).toContainText('Đã tạo 3 mẫu email.');
});

test('chọn mẫu khác đổ lại toàn bộ trường biên tập và preview', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);

  const firstSubject = await page.locator('#edit-subject').inputValue();
  await page.locator('#variants-grid .variant-card').nth(2).click();

  await expect(page.locator('#selected-tag')).toContainText('MẪU 03');
  await expect(page.locator('#finish-selected')).toContainText('Mẫu 03');
  const thirdSubject = await page.locator('#edit-subject').inputValue();
  expect(thirdSubject).not.toBe(firstSubject);
  await expect(page.locator('#variants-grid .variant-card').nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#variants-grid .variant-card').nth(0)).toHaveAttribute('aria-selected', 'false');
});

test('thiếu thương hiệu và thông điệp → báo lỗi tại chỗ, giữ nguyên bước 01', async ({ page }) => {
  await openStudio(page);
  await fillCampaign(page, { brand: '', offer: '' });
  await page.locator('#generate-btn').click();

  await expect(page.locator('#brand-error')).toHaveText('Vui lòng nhập tên thương hiệu.');
  await expect(page.locator('#offer-error')).toHaveText('Vui lòng nhập thông điệp chính.');
  await expect(page.locator('#brand')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#brand')).toBeFocused();
  await expect(page.locator('#stage-1')).toBeVisible();
  await expect(page.locator('#stage-2')).toBeHidden();
  await expect(page.locator('#toast')).toContainText('Vui lòng bổ sung những thông tin bắt buộc.');
});

test('chỉ khoảng trắng cũng bị coi là thiếu dữ liệu', async ({ page }) => {
  await openStudio(page);
  await fillCampaign(page, { brand: '   ' });
  await page.locator('#generate-btn').click();

  await expect(page.locator('#brand-error')).toHaveText('Vui lòng nhập tên thương hiệu.');
  await expect(page.locator('#stage-1')).toBeVisible();
});

test('sửa lỗi rồi gửi lại thì lỗi cũ được xoá', async ({ page }) => {
  await openStudio(page);
  await fillCampaign(page, { brand: '' });
  await page.locator('#generate-btn').click();
  await expect(page.locator('#brand-error')).not.toBeEmpty();

  await fillCampaign(page, { brand: 'Nova Tech' });
  await page.locator('#generate-btn').click();

  await expect(page.locator('#brand-error')).toBeEmpty();
  await expect(page.locator('#stage-2')).toBeVisible();
  await expect(page.locator('#campaign-summary-brand')).toHaveText('Nova Tech');
});

test('viết lại theo từng tông giọng thay đổi cách diễn đạt nhưng giữ thông điệp', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);
  const offer = await page.locator('#offer').inputValue();

  await page.locator('input[name="tone"][value="formal"]').check();
  await page.locator('#rewrite-btn').click();
  await expect(page.locator('#edit-subject')).toHaveValue(/Quý khách/);
  await expect(page.locator('#edit-body')).toHaveValue(/Kính gửi/);
  await expect(page.locator('#toast')).toContainText('Đã viết lại mẫu email theo phong cách đã chọn.');

  await page.locator('input[name="tone"][value="fun"]').check();
  await page.locator('#rewrite-btn').click();
  await expect(page.locator('#edit-subject')).toHaveValue(/Có tin thú vị/);

  await page.locator('input[name="tone"][value="urgent"]').check();
  await page.locator('#rewrite-btn').click();
  await expect(page.locator('#edit-subject')).toHaveValue(/Đừng bỏ lỡ/);
  // Tông "khẩn cấp" không được bịa hạn chót/khan hiếm: thông điệp gốc vẫn còn nguyên.
  await expect(page.locator('#edit-body')).toHaveValue(new RegExp(offer.slice(0, 24)));
});

test('viết lại giữ nguyên đường dẫn CTA người dùng đã nhập', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);
  await page.locator('#edit-url').fill('https://lunacoffee.vn/uu-dai');
  await page.locator('#rewrite-btn').click();

  await expect(page.locator('#edit-url')).toHaveValue('https://lunacoffee.vn/uu-dai');
});

test('stepper khoá bước 02/03 cho tới khi có nội dung', async ({ page }) => {
  await openStudio(page);

  await expect(page.locator('#step-nav-1')).toBeEnabled();
  await expect(page.locator('#step-nav-2')).toBeDisabled();
  await expect(page.locator('#step-nav-3')).toBeDisabled();

  await generateEmails(page);
  await expect(page.locator('#step-nav-2')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('#step-nav-2')).toBeEnabled();
  await expect(page.locator('#step-nav-3')).toBeEnabled();
  await expect(page.locator('#step-nav-3')).not.toHaveAttribute('aria-current', 'step');
});

test('bước 03 hiển thị hộp thư đến đồng bộ với nội dung đang biên tập', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);
  await page.locator('#edit-subject').fill('Tiêu đề kiểm thử');
  await page.locator('#edit-body').fill('Thân bài kiểm thử.');
  await page.locator('#edit-cta').fill('Bấm vào đây');
  await goToPreview(page);

  await expect(page.locator('#sender-name')).toHaveText('Luna Coffee');
  await expect(page.locator('#sender-avatar')).toHaveText('LC');
  await expect(page.locator('#preview-subject')).toHaveText('Tiêu đề kiểm thử');
  await expect(page.locator('#preview-body')).toHaveText('Thân bài kiểm thử.');
  await expect(page.locator('#preview-cta')).toContainText('Bấm vào đây');
  await expect(page.locator('#finish-selected')).toHaveText('Mẫu 01 · Tập trung lợi ích');
});

test('gợi ý giờ gửi bám theo ngành hàng của chiến dịch', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);
  await goToPreview(page);

  await expect(page.locator('#timing-category')).toHaveText('Ẩm thực & đồ uống');
  await expect(page.locator('#time-primary')).toContainText('Thứ Ba');
  await expect(page.locator('#time-secondary')).toContainText('Thứ Năm');
  await expect(page.locator('#timing-reason')).not.toBeEmpty();

  await page.locator('#back-to-editor').click();
  await page.locator('#back-to-setup').click();
  await fillCampaign(page, { industry: 'tech' });
  await generateEmails(page);
  await goToPreview(page);

  await expect(page.locator('#timing-category')).toHaveText('Công nghệ & phần mềm');
  await expect(page.locator('#time-primary')).toContainText('Thứ Ba');
  await expect(page.locator('#time-primary')).toContainText('09:00');
});

test('chuyển desktop ↔ mobile chỉ đổi khung xem trước', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);
  await goToPreview(page);

  const canvas = page.locator('#preview-canvas');
  await expect(canvas).not.toHaveClass(/is-mobile/);

  await page.locator('.view-btn[data-view="mobile"]').click();
  await expect(canvas).toHaveClass(/is-mobile/);
  await expect(page.locator('.view-btn[data-view="mobile"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('.view-btn[data-view="desktop"]').click();
  await expect(canvas).not.toHaveClass(/is-mobile/);
});

test('chặn sang bước 03 khi tiêu đề trống, quay về đúng ô lỗi', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);
  await page.locator('#edit-subject').fill('');
  await page.locator('#to-preview').click();
  await expect(page.locator('#stage-2')).toBeVisible();

  await expect(page.locator('#edit-error')).toHaveText('Vui lòng nhập tiêu đề email trước khi tiếp tục.');
  await expect(page.locator('#edit-subject')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#edit-subject')).toBeFocused();
  await expect(page.locator('#stage-3')).toBeHidden();
});

test('chặn đường dẫn CTA sai giao thức', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);
  await page.locator('#edit-url').fill('ftp://lunacoffee.vn/file');
  await page.locator('#to-preview').click();

  await expect(page.locator('#edit-error')).toHaveText(
    'Đường dẫn CTA phải bắt đầu bằng http:// hoặc https://.',
  );
  await expect(page.locator('#edit-url')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#stage-2')).toBeVisible();

  await page.locator('#edit-url').fill('https://lunacoffee.vn/uu-dai');
  await goToPreview(page);
  await expect(page.locator('#stage-3')).toBeVisible();
});

test('"Tạo lại" sinh lại nội dung và giữ người dùng ở bước biên tập', async ({ page }) => {
  await openStudio(page);
  await generateEmails(page);
  await page.locator('#edit-subject').fill('Tiêu đề tạm');
  await page.locator('#regenerate-btn').click();

  await expect(page.locator('#toast')).toContainText('Đã tạo 3 mẫu email.');
  await expect(page.locator('#variants-grid .variant-card')).toHaveCount(3);
  await expect(page.locator('#stage-2')).toBeVisible();
  // Nội dung được sinh lại từ chiến dịch nên bản sửa tay không còn.
  await expect(page.locator('#edit-subject')).not.toHaveValue('Tiêu đề tạm');
});
