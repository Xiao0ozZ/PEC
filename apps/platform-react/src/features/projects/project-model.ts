import type {
  HtmlPageCatalog,
  HtmlPrototypePage,
  PagePrdLinks,
  ProjectClient,
  ProjectManifest,
} from '../../../../../packages/platform-contracts/src/index.js';

export function visibleProjects(projects: ProjectManifest[]) {
  return projects.filter((project) => project.homepage?.visible !== false);
}

export function findProject(projects: ProjectManifest[], projectId: string) {
  return projects.find((project) => project.id === projectId) ?? null;
}

export function findClient(project: ProjectManifest | null, clientId: string) {
  return project?.clients.find((client) => client.id === clientId) ?? null;
}

export function getClientPages(catalog: HtmlPageCatalog | undefined, projectId: string, clientId: string) {
  return catalog?.projects?.[projectId]?.[clientId] ?? [];
}

export type ClientRuntimeStatus = {
  state: 'ready' | 'index-missing' | 'empty';
  runnablePageCount: number;
  managedHtmlPageCount: number;
};

export function getClientRuntimeStatus(
  project: ProjectManifest,
  clientId: string,
  pages: HtmlPrototypePage[],
): ClientRuntimeStatus {
  const summary = project.pageRuntime?.clients?.[clientId];
  const managedHtmlPageCount = summary?.htmlTemplate ?? 0;
  const runnablePageCount = pages.length;

  if (runnablePageCount) {
    return { state: 'ready', runnablePageCount, managedHtmlPageCount };
  }
  if (managedHtmlPageCount) {
    return { state: 'index-missing', runnablePageCount, managedHtmlPageCount };
  }
  return { state: 'empty', runnablePageCount, managedHtmlPageCount };
}

export function getClientSections(catalog: HtmlPageCatalog | undefined, projectId: string, clientId: string) {
  return catalog?.sections?.[projectId]?.[clientId] ?? [];
}

export function getDefaultPage(client: ProjectClient, pages: HtmlPrototypePage[]) {
  const configured = String(client.defaultPage || '').replace(/^\/+|\/+$/gu, '');
  return (
    pages.find((page) => page.path === configured) ??
    pages.find((page) => page.menu !== false) ??
    pages[0] ??
    null
  );
}

export function getClientEntryPath(
  project: ProjectManifest,
  client: ProjectClient,
  pages: HtmlPrototypePage[],
) {
  const clientRoot = `/p/${project.id}/${client.id}`;
  const entryMode = client.entry?.mode ?? 'platform-login';
  if (entryMode === 'platform-login') return `${clientRoot}/login`;
  if (entryMode === 'custom-page') {
    const customPage = pages.find((page) => page.path === client.entry?.page);
    if (customPage) return `${clientRoot}/${customPage.path}`;
  }
  const page = getDefaultPage(client, pages);
  return page ? `${clientRoot}/${page.path}` : clientRoot;
}

export function groupClientPages(pages: HtmlPrototypePage[], sections: Array<{ id: string; title: string }>) {
  const groups = sections.map((section) => ({
    ...section,
    pages: pages.filter((page) => page.section === section.id && page.menu !== false),
  }));
  const knownSections = new Set(sections.map((section) => section.id));
  const ungrouped = pages.filter((page) => !knownSections.has(page.section) && page.menu !== false);
  if (ungrouped.length) groups.push({ id: 'other', title: '其他页面', pages: ungrouped });
  return groups.filter((group) => group.pages.length);
}

export function getPagePrdPath(links: PagePrdLinks | undefined, clientId: string, page: HtmlPrototypePage) {
  return links?.[clientId]?.[page.name] ?? null;
}

export function findPageBySource(pages: HtmlPrototypePage[], sourcePath: string) {
  const normalized = decodeURIComponent(sourcePath).replaceAll('\\', '/').replace(/^\/+/, '');
  return pages.find((page) => page.source.replaceAll('\\', '/').replace(/^\/+/, '') === normalized) ?? null;
}
