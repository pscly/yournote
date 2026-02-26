import {
  test,
  expect,
  setMockPairedRelationships,
  resetMockPairedRelationships,
} from './testBase.js';

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

test.describe('/users 配对视图空态与取消提示', () => {
  test.beforeEach(() => {
    resetMockPairedRelationships();
  });

  test.afterEach(() => {
    resetMockPairedRelationships();
  });

  test('当前配对关系为空时应显示“没有配对用户”', async ({ page }) => {
    await page.goto('/users');
    await ensureAccess(page);

    await expect(page.getByRole('heading', { name: '所有用户', level: 3 })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('当前配对关系', { exact: true })).toBeVisible();
    await expect(page.getByText('没有配对用户', { exact: true })).toBeVisible();
  });

  test('曾配对但当前无 active 关系时应显示“已取消配对”', async ({ page }) => {
    setMockPairedRelationships(1, [
      {
        id: 101,
        account_id: 1,
        is_active: false,
        paired_time: '2026-02-08T00:00:00Z',
        user: {
          id: 1,
          nideriji_userid: 10001,
          name: '测试用户',
          created_at: '2026-02-08T00:00:00Z',
        },
        paired_user: {
          id: 2,
          nideriji_userid: 10002,
          name: '配对用户',
          created_at: '2026-02-08T00:00:00Z',
        },
      },
    ]);

    await page.goto('/users');
    await ensureAccess(page);

    await expect(page.getByRole('heading', { name: '所有用户', level: 3 })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('其他主账号（当前未配对）', { exact: true })).toBeVisible();

    await expect(page.getByTestId('users-pairing-cancelled-1')).toBeVisible();
    await expect(page.getByTestId('users-pairing-cancelled-1')).toHaveText('已取消配对');
  });

  test('从未配对（rels=[]）时不应显示“已取消配对”', async ({ page }) => {
    await page.goto('/users');
    await ensureAccess(page);

    await expect(page.getByRole('heading', { name: '所有用户', level: 3 })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('其他主账号（当前未配对）', { exact: true })).toBeVisible();

    await expect(page.getByTestId('users-pairing-cancelled-1')).toHaveCount(0);
    await expect(page.getByText('已取消配对', { exact: true })).toHaveCount(0);
  });
});
