/**
 * Helper dùng chung cho các spec E2E. Không phải file `*.spec.mjs` nên Playwright
 * không chạy trực tiếp file này như test.
 */
import { expect } from '@playwright/test';

export const PAGES = {
  home: '#home-page',
  studio: '#studio-page',
  guide: '#guide-page',
};

/** Mở Studio và chờ trạng thái engine được xác định (tránh race với fetch /api/status). */
export async function openStudio(page) {
  await page.goto('/#studio');
  await expect(page.locator('#engine-label')).not.toHaveText('Đang kiểm tra kết nối');
  return page;
}

/** Mở một page bất kỳ theo hash. */
export async function openPage(page, name) {
  await page.goto(`/#${name}`);
  await expect(page.locator(`#${name}-page`)).toBeVisible();
}

/** Chạy wizard tới bước 2 với dữ liệu mặc định (Luna Coffee). */
export async function generateEmails(page) {
  await page.locator('#generate-btn').click();
  await expect(page.locator('#variants-grid .variant-card')).toHaveCount(3);
  await expect(page.locator('#stage-2')).toBeVisible();
}

/** Mở bước 3 (đi qua validateEditor). */
export async function goToPreview(page) {
  await page.locator('#to-preview').click();
  await expect(page.locator('#stage-3')).toBeVisible();
}

/**
 * Điền form chiến dịch, không submit.
 *
 * Radio "mục tiêu" dùng input 1×1 px ẩn sau label trang trí, nên `check()` sẽ bị
 * label chặn hit-test. Người dùng thật bấm vào label — test cũng làm vậy.
 */
export async function fillCampaign(page, campaign) {
  if (campaign.brand !== undefined) await page.locator('#brand').fill(campaign.brand);
  if (campaign.offer !== undefined) await page.locator('#offer').fill(campaign.offer);
  if (campaign.audience !== undefined) await page.locator('#audience').fill(campaign.audience);
  if (campaign.industry !== undefined) await page.locator('#industry').selectOption(campaign.industry);
  if (campaign.goal !== undefined) {
    const input = page.locator(`input[name="goal"][value="${campaign.goal}"]`);
    await page.locator('.goal-option').filter({ has: input }).click();
    await expect(input).toBeChecked();
  }
}

/** Khối "HTML của email" nằm trong <details> đóng sẵn — mở ra trước khi thao tác. */
export async function openHtmlDetails(page) {
  const details = page.locator('.html-details');
  if (!(await details.evaluate((element) => element.open))) {
    await details.locator('summary').click();
    await expect(details).toHaveJSProperty('open', true);
  }
}

/** Sinh HTML chuẩn từ nội dung hiện tại của mẫu đang chọn. */
export async function buildHtml(page) {
  await openHtmlDetails(page);
  await page.locator('#build-html-btn').click();
  await expect(page.locator('#html-state')).toContainText('HTML tuỳ chỉnh đang dùng');
}

/** Ghi HTML tuỳ chỉnh vào editor (tự mở <details> nếu cần). */
export async function setCustomHtml(page, html) {
  await openHtmlDetails(page);
  await page.locator('#html-editor').fill(html);
  await expect(page.locator('#html-state')).toContainText('HTML tuỳ chỉnh đang dùng');
}
