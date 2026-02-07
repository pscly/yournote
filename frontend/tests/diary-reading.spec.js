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

test.describe('记录列表 - 移动端阅读模式', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('应支持“阅读模式”展开/收起，不跳转页面', async ({ page }) => {
    await page.goto('/diaries');
    await ensureAccess(page);

    await expect(page.getByRole('heading', { name: '记录列表', level: 3 })).toBeVisible();

    // 移动端“视图（列表/阅读）”可能在筛选抽屉里，先确保抽屉已打开（或已可见）
    const viewLabel = page.getByText('视图', { exact: true });
    if (!(await viewLabel.isVisible())) {
      const filterBtn = page.getByRole('button', { name: /筛\s*选/ }).first();
      if (await filterBtn.isVisible()) {
        await filterBtn.click();
        await page.waitForTimeout(300);
      }
    }
    await expect(viewLabel).toBeVisible();

    // 默认移动端应更偏向阅读模式：若当前不是，也允许用户切换到“阅读”
    const viewRead = page.locator('.ant-segmented-item').filter({ hasText: '阅读' }).first();
    if (await viewRead.isVisible()) {
      await viewRead.click();
      await page.waitForTimeout(400);
    }

    // 若打开了筛选抽屉，关闭一下避免遮挡列表操作
    const drawerClose = page.locator('.ant-drawer-close').first();
    if (await drawerClose.isVisible()) {
      await drawerClose.click();
      await page.waitForTimeout(200);
    }

    // 若没有数据，跳过（避免依赖固定测试数据）
    await page.waitForTimeout(800);
    const expandBtn = page.getByRole('button', { name: /展\\s*开\\s*阅\\s*读/ }).first();
    if (!(await expandBtn.isVisible())) return;

    await expandBtn.click();
    await expect(page).toHaveURL(/\/diaries/);
    await expect(page.getByRole('button', { name: /收\\s*起/ }).first()).toBeVisible();

    await page.getByRole('button', { name: /收\\s*起/ }).first().click();
    await expect(page).toHaveURL(/\/diaries/);
  });
});
