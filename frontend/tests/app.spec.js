import { test, expect } from './testBase.js';


const SIDER_COLLAPSED_KEY = 'yournote_app_sider_collapsed_v1';

const getDesktopSider = (page) => page.locator('.ant-layout-sider').first();
const getDesktopSiderTrigger = (page) => page.locator('.ant-layout-sider-trigger').first();

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

  test('应该能够查看记录列表', async ({ page }) => {
    await page.goto('/diaries');
    await ensureAccess(page);
    await expect(page.getByRole('heading', { name: '记录列表', level: 3 })).toBeVisible();
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

  test('应该能够点击记录查看详情', async ({ page }) => {
    await page.goto('/diaries');
    await page.waitForTimeout(1000);
    const firstRow = page.locator('.ant-table-tbody tr').first();
    if (await firstRow.isVisible()) {
      // 列表列顺序：日期、修改时间、作者、标题...
      const titleCell = firstRow.locator('td').nth(3);
      await titleCell.click();
      await page.waitForTimeout(1000);
      await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
    }
  });

  test('记录列表详情入口应该是真链接并携带来源参数', async ({ page }) => {
    await page.goto('/diaries?view=list');
    await ensureAccess(page);

    const detailLink = page.locator('.ant-table-tbody tr a[href*="/diary/"]').first();
    await expect(detailLink).toBeVisible({ timeout: 15000 });
    await expect(detailLink).toHaveAttribute('href', /\/diary\/\d+\?from=%2Fdiaries%3Fview%3Dlist/);
  });

  test('应该在刷新后保持左侧栏折叠状态', async ({ page }) => {
    await page.goto('/');
    await ensureAccess(page);

    const sider = getDesktopSider(page);
    const trigger = getDesktopSiderTrigger(page);

    await expect(sider).toBeVisible();
    await expect(sider).not.toHaveClass(/ant-layout-sider-collapsed/);

    await trigger.click();
    await expect(sider).toHaveClass(/ant-layout-sider-collapsed/);

    await page.reload();
    await ensureAccess(page);
    await expect(sider).toHaveClass(/ant-layout-sider-collapsed/);
  });

  test('应该从本地存储恢复左侧栏折叠状态', async ({ page }) => {
    await page.addInitScript(([storageKey]) => {
      window.localStorage.setItem(storageKey, '1');
    }, [SIDER_COLLAPSED_KEY]);

    await page.goto('/');
    await ensureAccess(page);

    await expect(getDesktopSider(page)).toHaveClass(/ant-layout-sider-collapsed/);
  });


  test('本地存储是非法值时应回退为默认展开', async ({ page }) => {
    await page.addInitScript(([storageKey]) => {
      window.localStorage.setItem(storageKey, 'invalid');
    }, [SIDER_COLLAPSED_KEY]);

    await page.goto('/');
    await ensureAccess(page);

    await expect(getDesktopSider(page)).not.toHaveClass(/ant-layout-sider-collapsed/);
  });

});
