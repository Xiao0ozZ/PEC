import { expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FIXED_NOW = '2026-07-11T10:00:00+08:00';
const ignoredConsoleErrors = [/Failed to load resource/i, /favicon\.ico/i];

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function loadProjectRoutes() {
  const projectsRoot = path.join(projectRoot, 'projects');
  const entries = fs.existsSync(projectsRoot)
    ? fs.readdirSync(projectsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    : [];
  const projects = [];
  for (const entry of entries) {
    const packageRoot = path.join(projectsRoot, entry.name);
    const manifestPath = path.join(packageRoot, 'project.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.id !== entry.name) continue;
    const definitionsUrl = pathToFileURL(path.resolve(packageRoot, manifest.pageDefinitions));
    definitionsUrl.searchParams.set('e2e', String(Date.now()));
    const module = await import(definitionsUrl.href);
    projects.push({ manifest, definitions: module.clientPageDefinitions || module.default });
  }
  return projects;
}

const installedProjectRoutes = await loadProjectRoutes();

export function collectApplicationRoutes() {
  const routes = new Set(['/', '/components', '/tools/page-transfer', '/tools/projects']);
  for (const { manifest, definitions } of installedProjectRoutes) {
    routes.add(`/p/${manifest.id}`);
    for (const client of manifest.clients || []) {
      routes.add(`/p/${manifest.id}/${client.id}/login`);
      for (const page of definitions[client.id]?.pages || []) {
        routes.add(`/p/${manifest.id}/${client.id}/${page.path}`);
      }
    }
    if (manifest.mobile?.enabled) routes.add(`/p/${manifest.id}/mobile`);
    if (manifest.docs?.enabled) routes.add(`/p/${manifest.id}/docs`);
  }

  return [...routes].sort((left, right) => left.localeCompare(right));
}

export function captureRuntimeErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!ignoredConsoleErrors.some((pattern) => pattern.test(text))) errors.push(`console: ${text}`);
  });
  return errors;
}

export async function installStableBrowserState(page) {
  await page.addInitScript(
    ({ fixedNow }) => {
      window.localStorage.clear();
      window.localStorage.setItem('prototype-locale', 'zh-CN');
      const NativeDate = window.Date;
      const fixedTimestamp = new NativeDate(fixedNow).getTime();
      class FixedDate extends NativeDate {
        constructor(...args) {
          super(...(args.length ? args : [fixedTimestamp]));
        }
        static now() {
          return fixedTimestamp;
        }
      }
      Object.setPrototypeOf(FixedDate, NativeDate);
      window.Date = FixedDate;
    },
    { fixedNow: FIXED_NOW },
  );
}

export async function waitForPrototypeReady(page, routePath) {
  await page.goto(routePath, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app')).toBeVisible();
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
    `,
  });
  await page.waitForTimeout(routePath.includes('dashboard') || routePath.includes('war-room') ? 1_200 : 500);
}

export async function expectUsablePage(page) {
  const app = page.locator('#app');
  const bounds = await app.boundingBox();
  expect(bounds?.width || 0).toBeGreaterThan(300);
  expect(bounds?.height || 0).toBeGreaterThan(200);
  const readableText = (await app.innerText()).replace(/\s+/g, ' ').trim();
  const hasEmbeddedPrototype = await app.locator('iframe').count();
  expect(readableText.length > 20 || hasEmbeddedPrototype > 0).toBeTruthy();
}

export function expectNoRuntimeErrors(errors, routePath) {
  expect(errors, `页面 ${routePath} 存在运行错误`).toEqual([]);
}
