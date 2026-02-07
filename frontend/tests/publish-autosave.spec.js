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

test.describe('发布日记：草稿自动保存', () => {
  test('停止输入约 5 秒后会自动保存草稿（防抖）', async ({ page }) => {
    await mockPublishPageApis(page);

    await page.goto('/publish');
    await ensureAccess(page);

    const textarea = page.locator('textarea').first();
    const putPromise = page.waitForRequest(
      (req) => req.method() === 'PUT' && req.url().includes('/api/publish-diaries/draft/'),
      { timeout: 12000 },
    );

    await textarea.fill('自动保存测试 > 12:34:56');

    const req = await putPromise;
    const raw = req.postData() || '';
    expect(raw).toContain('自动保存测试');

    // 成功后应出现“已保存”文案（安静提示，不刷 message.success）
    await expect(page.getByText(/自动保存：已保存/)).toBeVisible({ timeout: 12000 });
  });
});

