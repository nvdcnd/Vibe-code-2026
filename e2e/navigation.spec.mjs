/**
 * Điều hướng SPA bằng hash: ba "trang" trong một index.html.
 * Hash không bao giờ tới server, nên đây là toàn bộ router của ứng dụng —
 * phải kiểm tra cả deep-link, tiêu đề tab và trạng thái aria của nav.
 */
import { expect, test } from '@playwright/test';

import { openPage, openStudio } from './helpers.mjs';

const TITLES = {
  home: 'MailCraft AI | Công cụ viết Email Marketing thông minh',
  studio: 'Tạo email | MailCraft AI',
  guide: 'Hướng dẫn | MailCraft AI',
};

test('mặc định vào trang chủ khi không có hash', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#home-page')).toBeVisible();
  await expect(page.locator('#studio-page')).toBeHidden();
  await expect(page.locator('#guide-page')).toBeHidden();
  await expect(page).toHaveTitle(TITLES.home);
  await expect(page.locator('.nav-link[data-page-link="home"]')).toHaveAttribute('aria-current', 'page');
});

for (const name of ['studio', 'guide']) {
  test(`deep-link #${name} mở đúng trang và đổi tiêu đề tab`, async ({ page }) => {
    await openPage(page, name);

    await expect(page).toHaveTitle(TITLES[name]);
    await expect(page.locator('#home-page')).toBeHidden();
    await expect(page.locator('.nav-link[data-page-link="' + name + '"]')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.locator('.nav-link[data-page-link="home"]')).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });
}

test('chỉ một <main> hiển thị tại mỗi thời điểm', async ({ page }) => {
  await openPage(page, 'guide');

  const visible = await page.locator('main:visible').count();
  expect(visible).toBe(1);
});

test('bấm nav đổi trang không cần tải lại', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.__noReload = true;
  });

  await page.locator('.nav-link[data-page-link="guide"]').click();
  await expect(page.locator('#guide-page')).toBeVisible();
  await expect(page).toHaveTitle(TITLES.guide);
  // Nếu trang bị tải lại thì biến đánh dấu sẽ mất.
  expect(await page.evaluate(() => window.__noReload)).toBe(true);
});

test('hash lạ rơi về trang chủ thay vì trang trắng', async ({ page }) => {
  await page.goto('/#khong-ton-tai');

  await expect(page.locator('#home-page')).toBeVisible();
  await expect(page).toHaveTitle(TITLES.home);
});

test('hash có query vẫn nhận đúng trang (deep-link có tham số)', async ({ page }) => {
  await page.goto('/#studio?utm=email');

  await expect(page.locator('#studio-page')).toBeVisible();
  await expect(page).toHaveTitle(TITLES.studio);
});

test('skip-link trỏ tới <main> đang hiển thị ở mọi trang', async ({ page }) => {
  for (const name of ['home', 'studio', 'guide']) {
    await openPage(page, name);
    await expect(page.locator('.skip-link')).toHaveAttribute('href', `#${name}-page`);
    await expect(page.locator('.skip-link')).toBeAttached();
  }
});

test('skip-link đưa focus vào nội dung chính (a11y bàn phím)', async ({ page }) => {
  await openStudio(page);
  await page.locator('.skip-link').focus();
  await page.keyboard.press('Enter');

  await expect(page.locator('#studio-page')).toBeFocused();
});

test('preset điền sẵn chiến dịch và đưa người dùng sang Studio', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-preset="launch"]').click();

  await expect(page.locator('#studio-page')).toBeVisible();
  await expect(page.locator('#brand')).toHaveValue('Nova Tech');
  await expect(page.locator('#industry')).toHaveValue('tech');
  await expect(page.locator('input[name="goal"][value="launch"]')).toBeChecked();
  await expect(page.locator('#brief-goal')).toHaveText('Ra mắt sản phẩm');
  await expect(page.locator('#stage-1')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Đã điền thông tin mẫu.');
});

test('preset "Chăm sóc khách hàng" chọn đúng mục tiêu giữ chân', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-preset="retention"]').click();

  await expect(page.locator('#brand')).toHaveValue('Green Market');
  await expect(page.locator('#brief-goal')).toHaveText('Chăm sóc khách hàng');
});

test.describe('menu di động', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('bật/tắt menu, đóng bằng Escape và khi bấm ra ngoài', async ({ page }) => {
    await page.goto('/');
    const button = page.locator('#mobile-menu-btn');
    const nav = page.locator('#site-nav');

    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'false');

    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(nav).toHaveClass(/is-open/);

    await page.keyboard.press('Escape');
    await expect(nav).not.toHaveClass(/is-open/);
    await expect(button).toHaveAttribute('aria-expanded', 'false');

    await button.click();
    await expect(nav).toHaveClass(/is-open/);
    // Bấm ra vùng nội dung (dropdown đang phủ lên phần hero nên phải chọn
    // toạ độ chắc chắn nằm ngoài cả topbar lẫn menu).
    await page.mouse.click(195, 780);
    await expect(nav).not.toHaveClass(/is-open/);
  });

  test('chọn trang trong menu thì menu tự đóng', async ({ page }) => {
    await page.goto('/');
    await page.locator('#mobile-menu-btn').click();
    await page.locator('.nav-link[data-page-link="guide"]').click();

    await expect(page.locator('#guide-page')).toBeVisible();
    await expect(page.locator('#site-nav')).not.toHaveClass(/is-open/);
  });
});

test('footer điều hướng được tới cả ba trang', async ({ page }) => {
  await page.goto('/');
  const footer = page.locator('.site-footer');

  await footer.locator('a[href="#studio"]').click();
  await expect(page.locator('#studio-page')).toBeVisible();

  await footer.locator('a[href="#guide"]').click();
  await expect(page.locator('#guide-page')).toBeVisible();

  await footer.locator('a[href="#home"]').click();
  await expect(page.locator('#home-page')).toBeVisible();
});
