import { test, expect } from './testBase.js';

const ensureAccess = async (page) => {
  const accessHeading = page.getByRole('heading', { name: '请输入访问密码', level: 3 });

  const shouldHandle = page.url().includes('/access');
  if (!shouldHandle) {
    try {
      await expect(accessHeading).toBeVisible({ timeout: 1200 });
    } catch {
      return;
    }
  }

  const password = process.env.ACCESS_PASSWORD_PLAINTEXT || '131';
  await page.getByPlaceholder('请输入访问密码').fill(password);
  await page.getByRole('button', { name: /进\s*入/ }).click();
  await expect(accessHeading).toBeHidden({ timeout: 15000 });
};

test.describe('留言数面板（E2E mock）', () => {
  test('Dashboard 应该展示留言数面板与今日新增', async ({ page }) => {
    await page.goto('/');
    await ensureAccess(page);

    await expect(page.getByTestId('msg-count-panel')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('msg-count-total')).toHaveText('7');
    await expect(page.getByTestId('msg-count-today-increase')).toHaveText('+3');
  });

  test('Dashboard top item 可点击并跳转到详情，详情应显示账号标签', async ({ page }) => {
    await page.goto('/');
    await ensureAccess(page);

    const topItem0 = page.getByTestId('msg-count-top-item-0');
    await expect(topItem0).toBeVisible({ timeout: 15000 });
    await topItem0.click();

    await expect(page).toHaveURL('/diary/1');
    await expect(page.getByTestId('diary-account-tag')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('diary-account-tag')).toContainText('账号 A1');
  });
});
