import { test, expect } from '@playwright/test';

test.describe('YourNote 应用测试', () => {
  test('应该能够加载首页', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible({ timeout: 15000 });
  });

  test('应该能够导航到账号管理页面', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: '账号管理' }).click();
    await expect(page).toHaveURL('/accounts');
  });

  test('应该能够添加账号', async ({ page }) => {
    await page.goto('/accounts');
    await page.click('text=快速添加当前账号');
    await page.waitForSelector('.ant-modal');
    await page.click('.ant-modal-footer button.ant-btn-primary');
    await page.waitForTimeout(2000);
  });

  test('应该能够查看日记列表', async ({ page }) => {
    await page.goto('/diaries');
    await expect(page.getByRole('heading', { name: '日记列表' })).toBeVisible();
  });

  test('应该能够查看所有用户', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: '所有用户' }).click();
    await expect(page).toHaveURL('/users');
    await expect(page.getByRole('heading', { name: '所有用户' })).toBeVisible({ timeout: 15000 });
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
