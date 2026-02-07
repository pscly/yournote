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

const mockPublishPageApis = async (page) => {
  // 发布页会加载账号/草稿/历史。测试不关心后端数据，直接 mock 掉，避免环境不稳定导致用例抖动。
  await page.route('**/api/accounts**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    });
  });

  await page.route('**/api/publish-diaries/runs**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    });
  });

  await page.route('**/api/publish-diaries/draft/*', async (route, request) => {
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: '', updated_at: null }),
      });
      return;
    }
    if (request.method() === 'PUT') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updated_at: '2026-02-07T12:00:00Z' }),
      });
      return;
    }
    await route.continue();
  });
};

test.describe('发布日记：时间转换', () => {
  test('应能把 > HH:MM / > HH:MM:SS 转成方括号并支持撤销', async ({ page }) => {
    await mockPublishPageApis(page);
    await page.goto('/publish');
    await ensureAccess(page);

    const textarea = page.locator('textarea').first();
    const input = [
      '今天 > 12:34 继续',
      '再来一个 > 12:34:56',
      '还有 >01:02:03',
      '以及 > 01:02',
      '以及 a>12:34:56 不应转换',
      '以及 a>12:34 不应转换',
    ].join('\n');

    await textarea.fill(input);
    await page.getByRole('button', { name: '时间转换' }).click();

    const after = await textarea.inputValue();
    expect(after).toContain('[12:34]');
    expect(after).toContain('[12:34:56]');
    expect(after).toContain('[01:02:03]');
    expect(after).toContain('[01:02]');
    expect(after).toContain('a>12:34:56');
    expect(after).toContain('a>12:34');

    await page.getByRole('button', { name: '撤销转换' }).click();
    await expect(textarea).toHaveValue(input);
  });
});
