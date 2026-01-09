import { test, expect } from '@playwright/test';

test.describe('YourNote 应用测试', () => {
  test('应该能够加载首页', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('仪表盘');
  });

  test('应该能够导航到账号管理页面', async ({ page }) => {
    await page.goto('/');
    await page.click('text=账号管理');
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
    await expect(page.locator('h1')).toContainText('日记列表');
  });

  test('应该能够查看所有用户', async ({ page }) => {
    await page.goto('/');
    await page.click('text=所有用户');
    await expect(page).toHaveURL('/users');
    await expect(page.locator('h1')).toContainText('所有用户');
  });

  test('应该能够点击用户查看详情', async ({ page }) => {
    await page.goto('/users');
    await page.waitForTimeout(1000);
    const firstUser = page.locator('.ant-card').first();
    if (await firstUser.isVisible()) {
      await firstUser.click();
      await page.waitForTimeout(1000);
      await expect(page.locator('text=用户信息')).toBeVisible();
    }
  });

  test('应该能够点击日记查看详情', async ({ page }) => {
    await page.goto('/diaries');
    await page.waitForTimeout(1000);
    const detailButton = page.locator('text=查看详情').first();
    if (await detailButton.isVisible()) {
      await detailButton.click();
      await page.waitForTimeout(1000);
      await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
    }
  });
});
