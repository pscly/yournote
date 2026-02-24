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

test.describe('留言记录页（/messages）', () => {
  test('默认按入库时间倒序', async ({ page }) => {
    const requestPromise = page.waitForRequest((req) => {
      try {
        const url = new URL(req.url());
        if (url.pathname !== '/api/diaries/query') return false;
        return (
          url.searchParams.get('order_by') === 'created_at'
          && url.searchParams.get('order') === 'desc'
          && url.searchParams.get('has_msg') === '1'
          && url.searchParams.get('scope') === 'all'
        );
      } catch {
        return false;
      }
    });

    await page.goto('/messages');
    await ensureAccess(page);

    await expect(page).toHaveURL(/\/messages\?/);
    await expect(page).toHaveURL(/hasMsg=1/);
    await expect(page).toHaveURL(/orderBy=created_at/);
    await expect(page).toHaveURL(/order=desc/);
    await expect(page).toHaveURL(/scope=all/);

    await requestPromise;
  });
});
