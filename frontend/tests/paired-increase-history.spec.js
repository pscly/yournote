import { test, expect } from '@playwright/test';

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

test.describe('新增配对记录历史页', () => {
  test('应该能打开并显示日期选择控件', async ({ page }) => {
    await page.goto('/paired-increase-history');
    await ensureAccess(page);

    await expect(page.getByRole('heading', { name: '新增配对记录（历史）', level: 3 })).toBeVisible();

    // antd Button 会对 2 个中文字符自动插入空格（例如 “昨天” -> “昨 天”）
    await expect(page.getByRole('button', { name: /今\s*天/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /昨\s*天/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /前\s*天/ })).toBeVisible();

    const dateInput = page.locator('input[type="date"]').first();
    await expect(dateInput).toBeVisible();

    await expect(page.getByText('包含停用账号', { exact: true })).toBeVisible();
  });
});
