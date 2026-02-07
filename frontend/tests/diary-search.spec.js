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

test.describe('记录列表搜索与筛选', () => {
  test('应该能看到搜索框与筛选控件，并支持 URL 复现', async ({ page }) => {
    await page.goto('/diaries');
    await ensureAccess(page);

    const searchInput = page.getByPlaceholder('搜索标题/内容（空格多关键词，默认 AND）');
    await expect(searchInput).toBeVisible();

    // 搜索模式（AND/OR）与语法模式（智能/纯文本）
    await expect(page.getByText('全部命中', { exact: true })).toBeVisible();
    await expect(page.getByText('任意命中', { exact: true })).toBeVisible();
    await expect(page.getByText('智能语法', { exact: true })).toBeVisible();

    // 说明：页面内可能在表格列头/测量单元格等位置也出现相同文本，避免 strict mode 命中多个元素导致失败
    await expect(page.getByText('范围', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('账号', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('作者', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('日期', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('排序', { exact: true }).first()).toBeVisible();

    // 尝试从第一行取一个标题片段做搜索；若无数据则跳过断言（避免依赖固定测试数据）
    await page.waitForTimeout(800);
    const firstRow = page.locator('.ant-table-tbody tr').first();
    if (!(await firstRow.isVisible())) return;

    const titleCell = firstRow.locator('td').nth(3);
    const titleTextRaw = (await titleCell.innerText()) || '';
    const titleText = titleTextRaw.trim();
    if (!titleText) return;

    const keyword = titleText.slice(0, Math.min(4, titleText.length));
    await searchInput.fill(keyword);
    await page.getByRole('button', { name: /搜\s*索/ }).click();

    await expect(page).toHaveURL(/\\bq=/);
    await expect(page).toHaveURL(/\\bscope=/);
    await expect(page).toHaveURL(/\\bpageSize=/);
    await expect(page).toHaveURL(/\\bmode=/);
    await expect(page).toHaveURL(/\\bsyntax=/);

    // 刷新后，条件应仍然存在（可复现）
    await page.reload();
    await ensureAccess(page);
    await expect(searchInput).toHaveValue(keyword);
  });

  test('切换范围不应报错', async ({ page }) => {
    await page.goto('/diaries');
    await ensureAccess(page);

    // 通过 segmented item 点击 “全部记录”
    const allScope = page.locator('.ant-segmented-item').filter({ hasText: '全部记录' }).first();
    if (await allScope.isVisible()) {
      await allScope.click();
      await page.waitForTimeout(600);
    }

    const matchedScope = page.locator('.ant-segmented-item').filter({ hasText: '仅配对用户' }).first();
    if (await matchedScope.isVisible()) {
      await matchedScope.click();
      await page.waitForTimeout(600);
    }

    await expect(page.getByRole('heading', { name: '记录列表', level: 3 })).toBeVisible();
  });
});
