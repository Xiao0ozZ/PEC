import { describe, expect, it } from 'vitest';

import type {
  HtmlPrototypePage,
  ProjectManifest,
} from '../../../../../packages/platform-contracts/src/index.js';
import {
  getClientEntryPath,
  getClientRuntimeStatus,
  getDefaultPage,
  groupClientPages,
} from './project-model';

const project = { id: 'demo', clients: [] } as unknown as ProjectManifest;
const pages = [
  { path: 'overview', name: 'overview', title: '概览', section: 'dashboard', menu: true },
  { path: 'detail', name: 'detail', title: '详情', section: 'orders', menu: false },
] as HtmlPrototypePage[];

describe('React project model', () => {
  it('respects configured entry modes without forcing a login page', () => {
    expect(
      getClientEntryPath(project, { id: 'admin', name: '管理端', entry: { mode: 'direct' } }, pages),
    ).toBe('/p/demo/admin/overview');
    expect(
      getClientEntryPath(project, { id: 'admin', name: '管理端', entry: { mode: 'platform-login' } }, pages),
    ).toBe('/p/demo/admin/login');
  });

  it('falls back to the first visible page and groups menu pages only', () => {
    expect(getDefaultPage({ id: 'admin', name: '管理端', defaultPage: 'missing' }, pages)?.path).toBe(
      'overview',
    );
    expect(
      groupClientPages(pages, [
        { id: 'dashboard', title: '看板' },
        { id: 'orders', title: '订单' },
      ]),
    ).toEqual([{ id: 'dashboard', title: '看板', pages: [pages[0]] }]);
  });

  it('distinguishes runnable, stale-index and empty clients', () => {
    const projectWithRuntime = {
      ...project,
      pageRuntime: {
        clients: {
          ready: { htmlTemplate: 2 },
          stale: { htmlTemplate: 2 },
        },
      },
    } as ProjectManifest;

    expect(getClientRuntimeStatus(projectWithRuntime, 'ready', pages).state).toBe('ready');
    expect(getClientRuntimeStatus(projectWithRuntime, 'stale', []).state).toBe('index-missing');
    expect(getClientRuntimeStatus(projectWithRuntime, 'empty', []).state).toBe('empty');
  });
});
