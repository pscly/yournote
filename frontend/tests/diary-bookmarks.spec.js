import { test, expect } from './testBase.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SAMPLE_TITLE = '测试标题';
const SAMPLE_DATE = '2026-02-08';

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

test.describe('书签关键链路', () => {
  test('列表页星标 -> 书签页导出 Markdown + 批量取消书签', async ({ page }) => {
    await page.goto('/diaries?view=list');
    await ensureAccess(page);

    await expect(page.getByRole('heading', { name: '记录列表', level: 3 })).toBeVisible({ timeout: 15000 });

    const addBookmarkBtn = page.getByTitle('加入书签').first();
    await expect(addBookmarkBtn).toBeVisible();
    await addBookmarkBtn.click();
    await expect(page.getByTitle('取消书签').first()).toBeVisible();

    await page.getByRole('menuitem', { name: '书签/收藏' }).click();
    await expect(page).toHaveURL(/\/bookmarks/);

    await page.goto('/bookmarks?view=list');
    await ensureAccess(page);
    await expect(page).toHaveURL(/\/bookmarks\?view=list/);

    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    const firstRow = table.getByRole('row').nth(1);
    await expect(firstRow).toBeVisible();
    await expect(firstRow).toContainText(SAMPLE_TITLE);
    await expect(firstRow).toContainText(SAMPLE_DATE);

    const selectAllCheckbox = table.getByRole('checkbox').first();
    await selectAllCheckbox.check();
    await expect(page.getByText(/已选\s*1\s*条/)).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 Markdown' }).click();
    const download = await downloadPromise;

    const outPath = path.join(os.tmpdir(), `yournote-bookmarks-${Date.now()}.md`);
    await download.saveAs(outPath);
    const md = await fs.readFile(outPath, 'utf8');

    expect(md).toContain('/diary/');
    expect(md).toContain(SAMPLE_TITLE);
    expect(md).toContain(SAMPLE_DATE);

    await page.getByRole('button', { name: '批量取消书签' }).click();
    await expect(page.getByText('暂无记录')).toBeVisible();
  });

  test('详情页收藏/取消收藏切换按钮文案', async ({ page }) => {
    await page.goto('/diary/1');
    await ensureAccess(page);

    const collectBtn = page.getByRole('button', { name: '收藏' });
    const cancelBtn = page.getByRole('button', { name: '取消收藏' });

    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click();
      await expect(collectBtn).toBeVisible();
    }

    await collectBtn.click();
    await expect(cancelBtn).toBeVisible();

    await cancelBtn.click();
    await expect(collectBtn).toBeVisible();
  });
});
