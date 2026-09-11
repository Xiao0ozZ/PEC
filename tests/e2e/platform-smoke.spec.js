import { expect, test } from '@playwright/test';

test('opens the React home and reveals management tools with the local shortcut', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/产品功能体验中心/u);
  await expect(page.getByRole('heading', { name: '产品功能体验中心' })).toBeVisible();
  await expect(page.getByRole('button', { name: '控制台' })).toHaveCount(0);

  await page.keyboard.press('Control+Shift+M');
  await page.getByRole('button', { name: '控制台' }).click();
  await expect(page.getByRole('heading', { name: '控制台' })).toBeVisible();
});

test('keeps management routes refreshable and reports unknown URLs', async ({ page }) => {
  await page.goto('/tools/page-transfer');
  await expect(page.getByRole('heading', { name: '页面导入导出' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '页面导入导出' })).toBeVisible();

  await page.goto('/route-that-does-not-exist');
  await expect(page.getByText('页面不存在')).toBeVisible();
});
