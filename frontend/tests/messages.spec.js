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

const isDiaryQueryRequest = (req, matcher) => {
  try {
    const url = new URL(req.url());
    if (url.pathname !== '/api/diaries/query') return false;
    return matcher(url);
  } catch {
    return false;
  }
};

const waitDiaryQueryRequest = (page, matcher) => page.waitForRequest((req) => isDiaryQueryRequest(req, matcher));

test.describe('留言记录页（/messages）', () => {
  test('默认按入库时间倒序且仅看有留言', async ({ page }) => {
    const requestPromise = waitDiaryQueryRequest(page, (url) => (
      url.searchParams.get('order_by') === 'created_at'
      && url.searchParams.get('order') === 'desc'
      && url.searchParams.get('has_msg') === '1'
      && url.searchParams.get('scope') === 'all'
    ));

    await page.goto('/messages');
    await ensureAccess(page);

    await expect(page).toHaveURL(/\/messages\?/);
    await expect(page).toHaveURL(/hasMsg=1/);
    await expect(page).toHaveURL(/orderBy=created_at/);
    await expect(page).toHaveURL(/order=desc/);
    await expect(page).toHaveURL(/scope=all/);

    await requestPromise;
  });

  test('显式 hasMsg=all 时不再强制改回仅有留言', async ({ page }) => {
    const requestPromise = waitDiaryQueryRequest(page, (url) => (
      !url.searchParams.has('has_msg')
      && url.searchParams.get('order_by') === 'created_at'
      && url.searchParams.get('order') === 'desc'
      && url.searchParams.get('scope') === 'all'
    ));

    await page.goto('/messages?hasMsg=all&orderBy=created_at&order=desc&scope=all');
    await ensureAccess(page);

    await expect(page).toHaveURL(/hasMsg=all/);
    await expect(page).toHaveURL(/orderBy=created_at/);
    await expect(page).toHaveURL(/order=desc/);
    await expect(page).toHaveURL(/scope=all/);

    await requestPromise;
  });

  test('显式 hasMsg=0 时查询仅无留言', async ({ page }) => {
    const requestPromise = waitDiaryQueryRequest(page, (url) => (
      url.searchParams.get('has_msg') === '0'
      && url.searchParams.get('order_by') === 'created_at'
      && url.searchParams.get('order') === 'desc'
      && url.searchParams.get('scope') === 'all'
    ));

    await page.goto('/messages?hasMsg=0&orderBy=created_at&order=desc&scope=all');
    await ensureAccess(page);

    await expect(page).toHaveURL(/hasMsg=0/);
    await requestPromise;
  });

  test('重置条件后恢复默认仅有留言和入库时间排序', async ({ page }) => {
    await page.goto('/messages?hasMsg=all&orderBy=msg_count&order=asc&scope=all');
    await ensureAccess(page);

    const requestPromise = waitDiaryQueryRequest(page, (url) => (
      url.searchParams.get('has_msg') === '1'
      && url.searchParams.get('order_by') === 'created_at'
      && url.searchParams.get('order') === 'desc'
      && url.searchParams.get('scope') === 'all'
    ));

    await page.getByRole('button', { name: '重置条件' }).click();
    await requestPromise;

    await expect(page).toHaveURL(/hasMsg=1/);
    await expect(page).toHaveURL(/orderBy=created_at/);
    await expect(page).toHaveURL(/order=desc/);
    await expect(page).toHaveURL(/scope=all/);
  });
});
