import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  migrateProjectManifest,
  normalizePagePrdLinks,
  normalizeProjectMounts,
  normalizePrototypeSources,
  applyRouteOrder,
  resolveProjectDocsRoot,
  resolveProjectPrototypeSources,
  scanProjectPackages,
  validateProjectManifest,
  writeJsonAtomic,
} from '../../packages/project-core/src/index.js';

describe('project core', () => {
  it('normalizes per-client and fallback prototype sources', () => {
    expect(
      normalizePrototypeSources({
        enabled: true,
        clients: {
          admin: { root: 'prototype/admin', shellMode: 'full' },
          hidden: { root: 'prototype/hidden', enabled: false },
        },
      }),
    ).toEqual([
      {
        clientId: 'admin',
        root: 'prototype/admin',
        section: '',
        icon: '',
        shellMode: 'full',
        enabled: true,
      },
    ]);
    expect(normalizePrototypeSources({ enabled: true, root: 'prototype', client: 'admin' })).toHaveLength(1);
  });

  it('resolves local mount overrides without changing the project manifest', () => {
    const projectRoot = path.join(os.tmpdir(), 'sample-project');
    const docsRoot = path.join(os.tmpdir(), 'sample-docs');
    const prototypeRoot = path.join(os.tmpdir(), 'sample-prototype');
    const manifest = {
      id: 'sample-project',
      docs: { enabled: true, root: 'docs' },
      prototype: {
        enabled: true,
        clients: { admin: { root: 'prototype/admin' } },
      },
    };
    const mounts = normalizeProjectMounts({
      schemaVersion: 1,
      projects: {
        'sample-project': {
          docsRoot,
          prototypes: { admin: prototypeRoot },
        },
      },
    });

    expect(resolveProjectDocsRoot(manifest, projectRoot, mounts)).toBe(path.resolve(docsRoot));
    expect(resolveProjectPrototypeSources(manifest, projectRoot, mounts)).toEqual([
      expect.objectContaining({
        clientId: 'admin',
        configuredRoot: 'prototype/admin',
        root: path.resolve(prototypeRoot),
        mounted: true,
      }),
    ]);
    expect(manifest.docs.root).toBe('docs');
    expect(manifest.prototype.clients.admin.root).toBe('prototype/admin');
  });

  it('keeps PRD link paths relative and strips invalid entries', () => {
    expect(
      normalizePagePrdLinks('demo', {
        links: {
          admin: {
            home: 'docs/home.md',
            removed: null,
          },
        },
      }),
    ).toEqual({
      schemaVersion: 1,
      projectId: 'demo',
      links: { admin: { home: 'docs/home.md', removed: null } },
    });
    expect(() => normalizePagePrdLinks('demo', { links: { admin: { unsafe: '../outside.md' } } })).toThrow(
      /PRD 路径无效/,
    );
  });

  it('validates the manifest contract before checking project files', () => {
    const errors = validateProjectManifest(
      {
        schemaVersion: 1,
        id: 'wrong-id',
        name: '',
        pageDefinitions: '../pages.js',
        clients: [],
        entries: [],
      },
      'expected-id',
      path.join(os.tmpdir(), 'expected-id'),
    );
    expect(errors).toContain('项目 id 必须与项目文件夹名称一致。');
    expect(errors).toContain('缺少项目名称。');
    expect(errors).toContain('pageDefinitions 必须是项目包内的相对路径。');
  });

  it('migrates only supported schema versions without mutating input', () => {
    const manifest = { schemaVersion: 1, id: 'demo' };
    const migrated = migrateProjectManifest(manifest);
    expect(migrated).toEqual(manifest);
    expect(migrated).not.toBe(manifest);
    expect(() => migrateProjectManifest({ schemaVersion: 2 })).toThrow(/高于当前支持版本/);
  });

  it('applies configured section and page order without dropping unknown items', () => {
    const result = applyRouteOrder(
      {
        admin: {
          sections: [
            { id: 'first', title: 'First' },
            { id: 'second', title: 'Second' },
          ],
          pages: [
            { name: 'a', section: 'first' },
            { name: 'b', section: 'second' },
            { name: 'c', section: 'second' },
          ],
        },
      },
      {
        clients: {
          admin: {
            sectionOrder: ['second', 'first'],
            pageOrder: { second: ['c', 'b'] },
          },
        },
      },
    );
    expect(result.admin.sections.map((section) => section.id)).toEqual(['second', 'first']);
    expect(result.admin.pages.map((page) => page.name)).toEqual(['c', 'b', 'a']);
  });

  it('scans a minimal project package through the shared core', async () => {
    const projectsRoot = await fs.mkdtemp(path.join(process.cwd(), '.project-core-test-'));
    const projectRoot = path.join(projectsRoot, 'sample');
    try {
      await fs.mkdir(path.join(projectRoot, 'html-pages', 'admin'), { recursive: true });
      await writeJsonAtomic(path.join(projectRoot, 'project.json'), {
        schemaVersion: 1,
        id: 'sample',
        name: 'Sample',
        pageDefinitions: 'page-definitions.js',
        clients: [{ id: 'admin', name: 'Admin', defaultPage: 'home' }],
        entries: [{ id: 'admin', kind: 'client', clientId: 'admin', name: 'Admin' }],
        docs: { enabled: false },
        mobile: { enabled: false },
        prototype: { enabled: false },
        features: { designSystem: true },
      });
      await fs.writeFile(
        path.join(projectRoot, 'page-definitions.js'),
        `export const clientPageDefinitions = { admin: { sections: [{ id: 'work', title: 'Work' }], pages: [{ path: 'home', name: 'home', title: 'Home', sourceType: 'html-template', source: 'home.html', section: 'work' }] } };\n`,
        'utf8',
      );
      await fs.writeFile(
        path.join(projectRoot, 'html-pages', 'admin', 'home.html'),
        '<!doctype html><html><head><meta charset="UTF-8"><title>Home</title></head><body><main>Home</main></body></html>\n',
      );

      const result = await scanProjectPackages(projectsRoot);
      expect(result.invalidProjects).toEqual([]);
      expect(result.projects.map((project) => project.id)).toEqual(['sample']);
      expect(result.projects[0].pageRuntime).toEqual({
        clients: { admin: { htmlTemplate: 1 } },
      });
    } finally {
      await fs.rm(projectsRoot, { recursive: true, force: true });
    }
  });

  it('scans an external project root from the local mounts file without copying it', async () => {
    const projectsRoot = await fs.mkdtemp(path.join(process.cwd(), '.project-mount-root-test-'));
    const externalParent = await fs.mkdtemp(path.join(os.tmpdir(), 'platform-external-project-'));
    const externalRoot = path.join(externalParent, 'arbitrary-folder-name');
    try {
      await fs.cp(path.resolve(process.cwd(), 'examples/sample-project'), externalRoot, { recursive: true });
      const mounts = normalizeProjectMounts({
        schemaVersion: 1,
        projects: { 'sample-project': { root: externalRoot } },
      });
      const result = await scanProjectPackages(projectsRoot, { mounts });
      expect(result.invalidProjects).toEqual([]);
      expect(result.projects[0]).toMatchObject({ id: 'sample-project', mounted: true });
      expect(await fs.readdir(projectsRoot)).toEqual([]);
    } finally {
      await fs.rm(projectsRoot, { recursive: true, force: true });
      await fs.rm(externalParent, { recursive: true, force: true });
    }
  });
});
