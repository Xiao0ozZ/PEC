import { describe, expect, it } from 'vitest';

import type { ProjectManifest } from '../../../../../packages/platform-contracts/src/index.js';
import { buildProjectPayload, draftFromProject } from './project-config-model';

const project = {
  schemaVersion: 1,
  id: 'rental',
  name: '租赁项目',
  shortName: '租赁',
  version: '2.3.0',
  defaultLocale: 'zh-CN',
  description: '历史说明',
  theme: { primary: '#1677ff', primaryHover: '#0d62d6', primaryActive: '#0b52b3', pageBackground: '#f7f8fa' },
  clients: [
    {
      id: 'operation',
      name: '营运端',
      login: { account: 'admin', tenantCode: 'rimo' },
      extension: 'keep-me',
    },
  ],
  entries: [
    { id: 'operation', kind: 'client', clientId: 'operation', name: '营运端', order: 10 },
    { id: 'docs', kind: 'docs', name: '产品文档', order: 20 },
    { id: 'mobile', kind: 'mobile', name: '移动端', order: 30 },
  ],
  docs: { enabled: true, root: 'docs' },
  prototype: {
    enabled: true,
    root: 'prototype',
    clients: { operation: { root: 'prototype/operation', extra: 'keep-me' } },
  },
  mobile: { enabled: true, entry: 'mobile/index.html', mode: 'preview' },
  features: { designSystem: true, experimental: true },
  compatibility: { legacyRoutes: true, customFlag: true },
} as unknown as ProjectManifest;

describe('project configuration payload', () => {
  it('retains undisplayed project and client configuration while updating visible fields', () => {
    const draft = draftFromProject(project);
    draft.name = '租赁项目新版';
    draft.primary = '#2563eb';
    draft.clients[0].name = '营运管理端';
    const payload = buildProjectPayload(draft, true);

    expect(payload).toMatchObject({
      id: 'rental',
      name: '租赁项目新版',
      shortName: '租赁',
      version: '2.3.0',
      defaultLocale: 'zh-CN',
      primary: '#2563eb',
      pageBackground: '#f7f8fa',
      mobile: { enabled: true, entry: 'mobile/index.html', mode: 'preview' },
      features: { experimental: true },
      compatibility: { customFlag: true },
      prototype: { clients: { operation: { root: 'prototype/operation', extra: 'keep-me' } } },
    });
    expect(payload.clients[0]).toMatchObject({
      id: 'operation',
      name: '营运管理端',
      login: { account: 'admin', tenantCode: 'rimo' },
      extension: 'keep-me',
    });
    expect(payload.entries).toEqual(
      expect.arrayContaining([{ id: 'mobile', kind: 'mobile', name: '移动端', order: 30 }]),
    );
  });

  it('keeps a disabled documentation root for later re-enablement instead of losing it', () => {
    const draft = draftFromProject(project);
    draft.docsRoot = '';
    const payload = buildProjectPayload(draft, true);

    expect(payload.docs).toEqual({ enabled: false, root: 'docs' });
    expect(payload.entries.some((entry) => entry.kind === 'docs')).toBe(false);
  });
});
