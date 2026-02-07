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

const openFirstDiaryDetail = async (page) => {
  await page.goto('/diaries');
  await ensureAccess(page);
  await page.waitForTimeout(600);

  const vp = page.viewportSize();
  const isMobile = Boolean(vp && vp.width <= 480);

  const tryOpenByOpenDetailButton = async (timeoutMs) => {
    try {
      // 阅读模式（移动端常见）里有“打开详情”按钮，直接点它最稳定
      const openDetailBtn = page.getByRole('button', { name: /打\\s*开\\s*详\\s*情/ }).first();
      await openDetailBtn.click({ timeout: timeoutMs });
      await page.waitForURL(/\/diary\//, { timeout: 15000 });
      return true;
    } catch {
      return false;
    }
  };

  if (await tryOpenByOpenDetailButton(isMobile ? 8000 : 800)) return true;

  const firstRow = page.locator('.ant-table-tbody tr').first();
  if (await firstRow.isVisible()) {
    // 列表列顺序：日期、修改时间、作者、标题...
    const titleCell = firstRow.locator('td').nth(3);
    await titleCell.click();
  } else {
    const firstCard = page.locator('.ant-list .ant-card').first();
    if (!(await firstCard.isVisible())) return false;
    await firstCard.click();
  }

  // 主路径点击后：给一个短等待，避免页面渲染慢导致误判；失败则再尝试“打开详情”按钮（可能刚渲染出来）
  try {
    await page.waitForURL(/\/diary\//, { timeout: 4000 });
    return true;
  } catch {
    // ignore
  }

  if (await tryOpenByOpenDetailButton(isMobile ? 8000 : 2000)) return true;
  return false;
};

test.describe('记录详情页测试', () => {
  test('桌面端 - 应该显示固定导航栏', async ({ page }) => {       
    await page.goto('/');
    await ensureAccess(page);
    const header = page.locator('header');
    await expect(header).toBeVisible();

    const headerStyle = await header.evaluate(el => {
      const style = window.getComputedStyle(el);
      return {
        position: style.position,
        zIndex: style.zIndex
      };
    });

    expect(headerStyle.position).toBe('sticky');
    expect(parseInt(headerStyle.zIndex)).toBeGreaterThanOrEqual(100);
  });

  test('桌面端 - 记录详情页应该显示左侧记录列表', async ({ page }) => {
    if (await openFirstDiaryDetail(page)) {
      const sider = page.locator('.ant-layout-sider');
      await expect(sider).toBeVisible({ timeout: 15000 });

      const listTitle = page.getByRole('heading', { name: '记录列表' });        
      await expect(listTitle).toBeVisible({ timeout: 15000 });
    }
  });

  test('桌面端 - 应该显示匹配记录开关', async ({ page }) => {
    if (await openFirstDiaryDetail(page)) {
      await expect(page.getByRole('heading', { name: '记录列表' })).toBeVisible();

      const switchLabel = page.getByText('显示匹配记录', { exact: true });
      await expect(switchLabel).toBeVisible();

      const switchElement = page.locator('.ant-switch').first();
      await expect(switchElement).toBeVisible();
    }
  });

  test('桌面端 - 记录列表项应该有颜色边框', async ({ page }) => {
    if (await openFirstDiaryDetail(page)) {
      const listItem = page.locator('.ant-list-item').first();
      if (await listItem.isVisible()) {
        const borderLeft = await listItem.evaluate(el =>
          window.getComputedStyle(el).borderLeftWidth
        );
        expect(borderLeft).toBe('4px');
      }
    }
  });

  test('桌面端 - 应该显示记录内容和标签', async ({ page }) => {
    if (await openFirstDiaryDetail(page)) {
      const card = page.locator('.ant-card').first();
      await expect(card).toBeVisible();

      const tags = page.locator('.ant-tag');
      expect(await tags.count()).toBeGreaterThan(0);
    }
  });

  test('桌面端 - 页面底部应该显示附件区（含图号）', async ({ page }) => {
    if (!(await openFirstDiaryDetail(page))) return;

    const attachmentsCard = page.locator('.ant-card').filter({
      has: page.locator('.ant-card-head-title', { hasText: '附件（图片' }),
    }).first();
    await expect(attachmentsCard).toBeVisible({ timeout: 15000 });

    const titleText = (await attachmentsCard.locator('.ant-card-head-title').innerText()) || '';
    const match = titleText.match(/图片\\s*(\\d+)/);
    const imageCount = match ? Number(match[1]) : 0;

    if (imageCount > 0) {
      const imageLabels = attachmentsCard.locator('text=/^图\\d+$/');
      expect(await imageLabels.count()).toBeGreaterThan(0);
    }

    const historyCard = page.locator('.ant-card').filter({
      has: page.locator('.ant-card-head-title:has-text("修改历史")'),
    }).first();

    if (await historyCard.count()) {
      const historyBox = await historyCard.boundingBox();
      const attachmentsBox = await attachmentsCard.boundingBox();
      if (historyBox && attachmentsBox) {
        expect(attachmentsBox.y).toBeGreaterThan(historyBox.y);
      }
    }
  });

  test('桌面端 - 返回按钮应该可用', async ({ page }) => {
    if (await openFirstDiaryDetail(page)) {
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
    if (await openFirstDiaryDetail(page)) {
      await page.waitForTimeout(500);

      const menuButton = page.locator('text=记录列表').first();
      await expect(menuButton).toBeVisible();
    }
  });

  test('移动端 - 点击菜单按钮应该打开抽屉', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    if (await openFirstDiaryDetail(page)) {
      await page.waitForTimeout(500);

      const menuButton = page.locator('button:has-text("记录列表")').first();   
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
    await ensureAccess(page);
    const header = page.locator('header');
    await expect(header).toBeVisible();

    const headerStyle = await header.evaluate(el => {
      const style = window.getComputedStyle(el);
      return style.position;
    });

    expect(headerStyle).toBe('sticky');
  });
});

test.describe('响应式布局测试', () => {
  test('平板端 - 应该正确显示布局', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    if (await openFirstDiaryDetail(page)) {
      await page.waitForTimeout(500);

      await expect(page.getByRole('button', { name: '返回' })).toBeVisible();
    }
  });

  test('宽屏 - 应该正确显示三栏布局', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    if (await openFirstDiaryDetail(page)) {
      await page.waitForTimeout(500);

      const sider = page.locator('.ant-layout-sider');
      await expect(sider).toBeVisible();

      await expect(page.getByRole('button', { name: '返回' })).toBeVisible();
    }
  });
});
