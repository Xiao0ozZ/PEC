import path from 'node:path';

import { importJavaScriptFile, readJsonFile, resolveExistingPathInsideRoot } from './filesystem.js';
import { listProjectLocations } from './project-mounts.js';
import { validateProjectDefinitions } from './project-definitions.js';
import {
  toPublicProjectManifest,
  validateProjectManifest,
  validateProjectResources,
} from './project-manifest.js';

function summarizePageRuntime(manifest, definitions) {
  const clients = {};
  for (const client of manifest.clients || []) {
    const pages = Array.isArray(definitions?.[client.id]?.pages) ? definitions[client.id].pages : [];
    clients[client.id] = pages.reduce(
      (summary, page) => {
        if (page?.sourceType === 'html-template') summary.htmlTemplate += 1;
        return summary;
      },
      { htmlTemplate: 0 },
    );
  }
  return { clients };
}

export async function scanProjectPackages(projectsRoot, { cache, mounts = {} } = {}) {
  const root = path.resolve(projectsRoot);
  if (cache?.has(root)) return cache.get(root);
  const projects = [];
  const invalidProjects = [];
  const locations = await listProjectLocations(root, mounts);

  for (const location of locations) {
    const projectRoot = location.root;
    try {
      if (location.duplicateMountedRoot) {
        throw new Error(`项目同时存在于 projects 目录和外部挂载，已拒绝重复挂载。`);
      }
      const manifestPath = await resolveExistingPathInsideRoot(projectRoot, 'project.json', {
        allowedExtensions: new Set(['.json']),
      });
      if (!manifestPath) throw new Error('project.json 不存在、越界或不是 JSON 文件。');
      const manifest = await readJsonFile(manifestPath);
      const errors = validateProjectManifest(manifest, location.projectId, projectRoot);
      let pageRuntime = summarizePageRuntime(manifest, {});
      if (!errors.length) {
        const definitionsPath = await resolveExistingPathInsideRoot(
          projectRoot,
          manifest.pageDefinitions || '',
          { allowedExtensions: new Set(['.js']) },
        );
        if (!definitionsPath) {
          errors.push(`找不到页面定义文件：${manifest.pageDefinitions}。`);
        } else {
          const definitionsModule = await importJavaScriptFile(definitionsPath, {
            cacheKey: `${Date.now()}-${location.projectId}`,
          });
          const definitions = definitionsModule.clientPageDefinitions || definitionsModule.default;
          pageRuntime = summarizePageRuntime(manifest, definitions);
          errors.push(
            ...(await validateProjectDefinitions(manifest, projectRoot, definitions, {
              mounts,
            })),
          );
          errors.push(...(await validateProjectResources(manifest, projectRoot, { mounts })));
        }
      }
      if (errors.length) {
        invalidProjects.push({
          folder: location.projectId,
          mounted: location.mounted,
          project: toPublicProjectManifest(manifest),
          errors,
        });
      } else {
        projects.push({
          ...toPublicProjectManifest(manifest),
          folder: location.projectId,
          mounted: location.mounted,
          pageRuntime,
        });
      }
    } catch (error) {
      invalidProjects.push({
        folder: location.projectId,
        mounted: location.mounted,
        errors: [`project.json 读取失败：${error.message}`],
      });
    }
  }

  const result = { generatedAt: new Date().toISOString(), projects, invalidProjects };
  cache?.set(root, result);
  return result;
}
