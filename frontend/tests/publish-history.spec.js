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

test.describe('发布历史增强', () => {
  test('发布历史页应支持“按日期/按天汇总/按天连续阅读”多种查看方式', async ({ page }) => {
    await page.goto('/publish');
    await ensureAccess(page);

    // 切到“发布历史”Tab（antd 可能会插入空格）
    await page.getByRole('tab', { name: /发\s*布\s*历\s*史/ }).click();
    await page.waitForTimeout(300);

    await expect(page.getByText('查看方式', { exact: true })).toBeVisible();
    await expect(page.getByText(/按日期.*当日全部发布/)).toBeVisible();
    await expect(page.getByText(/按天汇总.*日终稿/)).toBeVisible();
    await expect(page.getByText(/按天连续阅读.*日终稿/)).toBeVisible();

    // 切到“按天汇总（日终稿）”，不要求后端有数据也能看到列表区
    await page.getByText(/按天汇总.*日终稿/).click();
    await page.waitForTimeout(400);

    await expect(page.getByText('日终稿（所有日子）', { exact: true })).toBeVisible();

    // 切到“按天连续阅读（日终稿）”，应出现时间线相关操作
    await page.getByText(/按天连续阅读.*日终稿/).click();
    await page.waitForTimeout(400);
    await expect(page.getByRole('button', { name: '展开最近 7 天' })).toBeVisible();
  });
});
