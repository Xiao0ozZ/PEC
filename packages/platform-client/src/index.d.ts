import type {
  DocumentManifest,
  BootstrapState,
  HtmlPageCatalog,
  PagePrdLinks,
  PlatformSettings,
  PrdBindingsPayload,
  ProjectScanResult,
  ProjectHealthReport,
  ProjectMountsPayload,
  RouteListResult,
  ShareStatus,
} from '../../platform-contracts/src/index.js';

export type RouteMutationAction =
  'create' | 'update' | 'delete' | 'restore' | 'order' | 'section-update' | 'section-restore';

export interface PlatformClient {
  readonly development: boolean;
  readonly apiMode: 'development' | 'local' | 'static';
  readonly baseUrl: string;
  loadProjectManifest(): Promise<ProjectScanResult>;
  loadBootstrapState(): Promise<BootstrapState>;
  loadProjectMounts(): Promise<ProjectMountsPayload>;
  loadProjectHealth(): Promise<ProjectHealthReport>;
  loadShareStatus(): Promise<ShareStatus>;
  saveShareEnabled(enabled: boolean): Promise<ShareStatus>;
  selectProjectDirectory(): Promise<Record<string, unknown>>;
  inspectProjectMount(root: string): Promise<Record<string, unknown>>;
  mountProject(root: string): Promise<Record<string, unknown>>;
  unmountProject(projectId: string): Promise<Record<string, unknown>>;
  installExampleProject(): Promise<Record<string, unknown>>;
  loadHtmlPageCatalog(): Promise<HtmlPageCatalog>;
  getHtmlPrototypeUrl(projectId: string, clientId: string, sourcePath: string): string;
  getHtmlPrototypeSourceDownloadUrl(projectId: string, clientId: string, sourcePath: string): string;
  getProjectAssetUrl(projectId: string, assetPath: string): string;
  saveProject(
    project: Record<string, unknown>,
    options?: { editing?: boolean },
  ): Promise<Record<string, unknown>>;
  loadPagePrdLinks(projectId: string): Promise<PagePrdLinks>;
  savePagePrdLinks(projectId: string, links: PagePrdLinks): Promise<PagePrdLinks>;
  loadPrdBindings(projectId: string): Promise<PrdBindingsPayload>;
  savePrdBindings(projectId: string, bindings: unknown[]): Promise<PrdBindingsPayload>;
  getDocumentAssetUrl(projectId: string, documentPath: string): string;
  loadDocumentManifest(projectId: string): Promise<DocumentManifest>;
  loadDocument(projectId: string, documentPath: string): Promise<string>;
  loadPlatformSettings(): Promise<PlatformSettings>;
  savePlatformSettings(settings: PlatformSettings): Promise<PlatformSettings>;
  inspectHtml(html: string): Promise<Record<string, unknown>>;
  importPage(html: string, target: Record<string, unknown>): Promise<Record<string, unknown>>;
  exportPages(input: {
    projectId: string;
    selectedPaths?: string[];
    packageName?: string;
  }): Promise<Record<string, unknown>>;
  listRoutes(projectId: string): Promise<RouteListResult>;
  mutateRoute(action: RouteMutationAction, target: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export function createPlatformClient(options?: {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  development?: boolean;
  apiMode?: 'development' | 'local' | 'static';
}): PlatformClient;
