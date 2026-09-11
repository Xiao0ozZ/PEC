import { test } from '@playwright/test';
import {
  captureRuntimeErrors,
  collectApplicationRoutes,
  expectNoRuntimeErrors,
  expectUsablePage,
  installStableBrowserState,
  waitForPrototypeReady,
} from './test-helpers';

const routes = collectApplicationRoutes();

test.describe('全部路由冒烟检查', () => {
  test.beforeEach(async ({ page }) => {
    await installStableBrowserState(page);
  });

  for (const routePath of routes) {
    test(`${routePath} 可以正常显示`, async ({ page }) => {
      const runtimeErrors = captureRuntimeErrors(page);
      await waitForPrototypeReady(page, routePath);
      await expectUsablePage(page);
      expectNoRuntimeErrors(runtimeErrors, routePath);
    });
  }
});
