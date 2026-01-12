import { test, expect } from '@playwright/test';

const ensureAccess = async (page) => {
  const accessHeading = page.getByRole('heading', { name: '请输入访问密码', level: 3 });

  // 部分接口在后端开启门禁后会触发 401 + ACCESS_REQUIRED，然后前端自动跳转 /access。
  // 这里做一次 best-effort 的自动登录，让测试在「门禁开/关」两种模式都能跑通。
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

test.describe('YourNote 应用测试', () => {
  test('应该能够加载首页', async ({ page }) => {
    await page.goto('/');
    await ensureAccess(page);
    await expect(page.getByRole('heading', { name: '仪表盘', level: 3 })).toBeVisible({ timeout: 15000 });
  });

  test('应该能够导航到账号管理页面', async ({ page }) => {
    await page.goto('/');
    await ensureAccess(page);
    await page.getByRole('menuitem', { name: '账号管理' }).click();
    await expect(page).toHaveURL('/accounts');
  });

  test('应该能够添加账号', async ({ page }) => {
    await page.goto('/accounts');
    await ensureAccess(page);
    await page.getByRole('button', { name: /快速添加/ }).click();
    await page.waitForSelector('.ant-modal');
    await page.click('.ant-modal-footer button.ant-btn-primary');
    await page.waitForTimeout(2000);
  });

  test('应该能够查看日记列表', async ({ page }) => {
    await page.goto('/diaries');
    await ensureAccess(page);
    await expect(page.getByRole('heading', { name: '日记列表', level: 3 })).toBeVisible();
  });

  test('应该能够查看所有用户', async ({ page }) => {
    await page.goto('/');
    await ensureAccess(page);
    await page.getByRole('menuitem', { name: '所有用户' }).click();
    await expect(page).toHaveURL('/users');
    await expect(page.getByRole('heading', { name: '所有用户', level: 3 })).toBeVisible({ timeout: 30000 });
  });

  test('应该能够点击用户查看详情', async ({ page }) => {
    await page.goto('/users');
    await page.waitForTimeout(1000);
    const firstUser = page.locator('.ant-card').filter({ hasText: 'Nideriji ID:' }).first();
    if (await firstUser.isVisible()) {
      await firstUser.click();
      await page.waitForTimeout(1000);
      await expect(page.locator('.ant-card-head-title', { hasText: '用户信息' })).toBeVisible();
    }
  });

  test('应该能够点击日记查看详情', async ({ page }) => {
    await page.goto('/diaries');
    await page.waitForTimeout(1000);
    const firstRow = page.locator('.ant-table-tbody tr').first();
    if (await firstRow.isVisible()) {
      const titleCell = firstRow.locator('td').nth(2);
      await titleCell.click();
      await page.waitForTimeout(1000);
      await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
    }
  });
});
