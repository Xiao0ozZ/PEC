import { expect, test } from '@playwright/test';
import { installStableBrowserState, waitForPrototypeReady } from './test-helpers';

const visualPages = [
  { name: 'home', path: '/' },
  { name: 'design-system', path: '/components' },
  { name: 'operation-login', path: '/p/rimo-rental/operation/login' },
  { name: 'operation-workbench', path: '/p/rimo-rental/operation/workbench' },
  { name: 'operation-dashboard', path: '/p/rimo-rental/operation/dashboard' },
  { name: 'war-room', path: '/p/rimo-rental/operation/war-room' },
  { name: 'store-orders', path: '/p/rimo-rental/operation/store-orders' },
  { name: 'order-detail', path: '/p/rimo-rental/operation/order-detail' },
  { name: 'platform-employees', path: '/p/rimo-rental/operation/employees' },
  { name: 'marketing', path: '/p/rimo-rental/operation/marketing' },
  { name: 'enterprise-login', path: '/p/rimo-rental/enterprise/login' },
  { name: 'enterprise-dashboard', path: '/p/rimo-rental/enterprise/dashboard' },
  { name: 'official-orders', path: '/p/rimo-rental/enterprise/official-order' },
  { name: 'official-vehicles', path: '/p/rimo-rental/enterprise/official-vehicles' },
  { name: 'official-order-add', path: '/p/rimo-rental/enterprise/official-order-add' },
  { name: 'car-use-management', path: '/p/rimo-rental/enterprise/car-use-management' },
  {
    name: 'document-center',
    path: `/docs?file=${encodeURIComponent('门市租赁/门市租赁端到端业务流程.md')}`,
  },
];

test.describe('关键页面视觉基线', () => {
  test.beforeEach(async ({ page }) => {
    await installStableBrowserState(page);
  });

  for (const visualPage of visualPages) {
    test(`${visualPage.name} 与基线一致`, async ({ page }) => {
      await waitForPrototypeReady(page, visualPage.path);
      await expect(page).toHaveScreenshot(`${visualPage.name}.png`, {
        animations: 'disabled',
        caret: 'hide',
        fullPage: false,
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});
