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

    await expect(page.getByText('包含停用账号').first()).toBeVisible();
  });

  test('历史记录列表链接不应窄到导致逐字换行', async ({ page }) => {
    await page.route('**/api/stats/paired-diaries/increase**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          diaries: [
            {
              id: 1,
              account_id: 1,
              user_id: 1,
              title: '测试历史标题',
              content: '这是一个用于验证历史记录列表布局不会被压窄的预览内容。',
              created_date: '2026-03-15',
              created_at: '2026-03-15T10:00:00Z',
              ts: 1773542400000,
              msg_count: 7,
              word_count_no_ws: 26,
            },
          ],
          authors: [
            {
              id: 1,
              nideriji_userid: 10001,
              name: '测试用户',
            },
          ],
        }),
      });
    });

    await page.goto('/paired-increase-history');
    await ensureAccess(page);

    const historyLink = page.getByRole('link', { name: /测试历史标题/ }).first();
    await expect(historyLink).toBeVisible({ timeout: 15000 });

    const width = await historyLink.evaluate((el) => Math.round(el.getBoundingClientRect().width));
    expect(width).toBeGreaterThan(150);
  });
});
