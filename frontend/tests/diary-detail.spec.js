import { test, expect, devices } from '@playwright/test';

test.describe('日记详情页测试', () => {
  test('桌面端 - 应该显示固定导航栏', async ({ page }) => {
    await page.goto('/');
    const header = page.locator('header');
    await expect(header).toBeVisible();

    const headerStyle = await header.evaluate(el => {
      const style = window.getComputedStyle(el);
      return {
        position: style.position,
        zIndex: style.zIndex
      };
    });

    expect(headerStyle.position).toBe('fixed');
    expect(parseInt(headerStyle.zIndex)).toBeGreaterThanOrEqual(1000);
  });

  test('桌面端 - 日记详情页应该显示左侧日记列表', async ({ page }) => {
    await page.goto('/diaries');
    await page.waitForTimeout(1000);

    const detailButton = page.locator('text=查看详情').first();
    if (await detailButton.isVisible()) {
      await detailButton.click();
      await page.waitForTimeout(1000);

      const sider = page.locator('.ant-layout-sider');
      await expect(sider).toBeVisible();

      const listTitle = page.locator('text=日记列表');
      await expect(listTitle).toBeVisible();
    }
  });

  test('桌面端 - 应该显示匹配日记开关', async ({ page }) => {
    await page.goto('/diaries');
    await page.waitForTimeout(1000);

    const detailButton = page.locator('text=查看详情').first();
    if (await detailButton.isVisible()) {
      await detailButton.click();
      await page.waitForTimeout(1000);

      const switchElement = page.locator('.ant-switch');
      await expect(switchElement).toBeVisible();

      const switchLabel = page.locator('text=显示匹配日记');
      await expect(switchLabel).toBeVisible();
    }
  });

  test('桌面端 - 日记列表项应该有颜色边框', async ({ page }) => {
    await page.goto('/diaries');
    await page.waitForTimeout(1000);

    const detailButton = page.locator('text=查看详情').first();
    if (await detailButton.isVisible()) {
      await detailButton.click();
      await page.waitForTimeout(1000);

      const listItem = page.locator('.ant-list-item').first();
      if (await listItem.isVisible()) {
        const borderLeft = await listItem.evaluate(el =>
          window.getComputedStyle(el).borderLeftWidth
        );
        expect(borderLeft).toBe('4px');
      }
    }
  });

  test('桌面端 - 应该显示日记内容和标签', async ({ page }) => {
    await page.goto('/diaries');
    await page.waitForTimeout(1000);

    const detailButton = page.locator('text=查看详情').first();
    if (await detailButton.isVisible()) {
      await detailButton.click();
      await page.waitForTimeout(1000);

      const card = page.locator('.ant-card').first();
      await expect(card).toBeVisible();

      const tags = page.locator('.ant-tag');
      expect(await tags.count()).toBeGreaterThan(0);
    }
  });

  test('桌面端 - 返回按钮应该可用', async ({ page }) => {
    await page.goto('/diaries');
    await page.waitForTimeout(1000);

    const detailButton = page.locator('text=查看详情').first();
    if (await detailButton.isVisible()) {
      await detailButton.click();
      await page.waitForTimeout(1000);

      const backButton = page.locator('text=返回');
      await expect(backButton).toBeVisible();
      await backButton.click();
      await page.waitForTimeout(500);
      await expect(page).toHaveURL(/\/diaries/);
    }
  });
});

test.describe('移动端测试', () => {
  test('移动端 - 应该显示菜单按钮', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/diaries');
    await page.waitForTimeout(1000);

    const detailButton = page.locator('text=查看详情').first();
    if (await detailButton.isVisible()) {
      await detailButton.click();
      await page.waitForTimeout(1000);

      const menuButton = page.locator('text=日记列表').first();
      await expect(menuButton).toBeVisible();
    }
  });

  test('移动端 - 点击菜单按钮应该打开抽屉', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/diaries');
    await page.waitForTimeout(1000);

    const detailButton = page.locator('text=查看详情').first();
    if (await detailButton.isVisible()) {
      await detailButton.click();
      await page.waitForTimeout(1000);

      const menuButton = page.locator('button:has-text("日记列表")').first();
      if (await menuButton.isVisible()) {
        await menuButton.click();
        await page.waitForTimeout(500);

        const drawer = page.locator('.ant-drawer');
        await expect(drawer).toBeVisible();
      }
    }
  });

  test('移动端 - 导航栏应该固定在顶部', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const header = page.locator('header');
    await expect(header).toBeVisible();

    const headerStyle = await header.evaluate(el => {
      const style = window.getComputedStyle(el);
      return style.position;
    });

    expect(headerStyle).toBe('fixed');
  });
});

test.describe('响应式布局测试', () => {
  test('平板端 - 应该正确显示布局', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/diaries');
    await page.waitForTimeout(1000);

    const detailButton = page.locator('text=查看详情').first();
    if (await detailButton.isVisible()) {
      await detailButton.click();
      await page.waitForTimeout(1000);

      const content = page.locator('.ant-layout-content');
      await expect(content).toBeVisible();
    }
  });

  test('宽屏 - 应该正确显示三栏布局', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/diaries');
    await page.waitForTimeout(1000);

    const detailButton = page.locator('text=查看详情').first();
    if (await detailButton.isVisible()) {
      await detailButton.click();
      await page.waitForTimeout(1000);

      const sider = page.locator('.ant-layout-sider');
      await expect(sider).toBeVisible();

      const content = page.locator('.ant-layout-content');
      await expect(content).toBeVisible();
    }
  });
});
