export type PlatformErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | 'STATIC_READ_ONLY'
  | 'UNKNOWN';

export interface PlatformErrorPayload {
  ok?: false;
  code?: PlatformErrorCode | string;
  message?: string;
  error?: string;
  detail?: unknown;
  details?: unknown;
}

export class PlatformApiError extends Error {
  code: PlatformErrorCode | string;
  status: number;
  detail: unknown;
  constructor(
    message: string,
    options?: { code?: PlatformErrorCode | string; status?: number; detail?: unknown; cause?: unknown },
  );
}

export interface ProjectClient {
  id: string;
  name: string;
  description?: string;
  defaultPage?: string;
  basePath?: string;
  icon?: string;
  entry?: { mode?: 'direct' | 'platform-login' | 'custom-page'; page?: string };
  layout?: { type?: 'sidebar' | 'topnav' | 'none' | 'bare' };
  [key: string]: unknown;
}

export interface ProjectEntry {
  id: string;
  kind: 'client' | 'docs' | 'mobile';
  clientId?: string;
  name: string;
  description?: string;
  icon?: string;
  order?: number;
}

export interface ProjectManifest {
  schemaVersion: number;
  id: string;
  name: string;
  version?: string;
  mounted?: boolean;
  clients: ProjectClient[];
  shortName?: string;
  description?: string;
  homepage?: { visible?: boolean };
  entries?: ProjectEntry[];
  docs?: { enabled?: boolean; root?: string };
  mobile?: { enabled?: boolean; entry?: string };
  theme?: { primary?: string; primaryHover?: string; primaryActive?: string; pageBackground?: string };
  branding?: { logo?: string; favicon?: string };
  compatibility?: { legacyRoutes?: boolean; legacyViewRoot?: string; [key: string]: unknown };
  pageRuntime?: {
    clients: Record<string, { htmlTemplate: number; vueSfc: number }>;
  };
  [key: string]: unknown;
}

export interface InvalidProject {
  folder: string;
  mounted?: boolean;
  errors: string[];
  [key: string]: unknown;
}

export interface ProjectScanResult {
  generatedAt: string;
  projects: ProjectManifest[];
  invalidProjects: InvalidProject[];
  [key: string]: unknown;
}

export interface HtmlPrototypePage {
  path: string;
  name: string;
  title: string;
  sourceType: 'html-direct' | 'html-template';
  source: string;
  sourceRoot: string;
  renderMode?: 'content-only' | 'full';
  section: string;
  icon?: string;
  menu?: boolean;
  [key: string]: unknown;
}

export interface HtmlPageCatalog {
  generatedAt: string;
  projects: Record<string, Record<string, HtmlPrototypePage[]>>;
  sections: Record<string, Record<string, Array<{ id: string; title: string }>>>;
}

export interface DocumentEntry {
  path: string;
  title?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface DocumentManifest {
  generatedAt: string;
  documents: DocumentEntry[];
  [key: string]: unknown;
}

export type PagePrdLinks = Record<string, Record<string, string | null>>;

export interface PrdBindingTarget {
  domPath: number[];
  tag: string;
  classes?: string[];
  text?: string;
  [key: string]: unknown;
}

export interface PrdBindingReference {
  document: string;
  anchor: string;
  label?: string;
  summary?: string;
  [key: string]: unknown;
}

export interface PrdBinding {
  id: string;
  pagePath: string;
  target: PrdBindingTarget;
  prd: PrdBindingReference;
  [key: string]: unknown;
}

export interface PrdBindingsPayload {
  schemaVersion: 1;
  bindings: PrdBinding[];
}

export interface PlatformSettings {
  developerMode: boolean;
}

export interface RouteListResult {
  ok: true;
  clients: Array<Record<string, unknown>>;
  backups: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ShareStatus {
  sharing: boolean;
  managedByStartup: boolean;
  canControl: boolean;
  readOnly: boolean;
  writeEnabled: boolean;
  host: string;
  port: number;
  urls: { local: string; lan: string[] };
  message: string;
}

export interface BootstrapState {
  runtime: {
    local?: boolean;
    writeEnabled?: boolean;
    readOnly?: boolean;
    host?: string;
    port?: number;
    share?: ShareStatus;
  };
  workspace: {
    projectsDirectoryReady?: boolean;
    mountsConfigured?: number;
    projects?: number;
    invalidProjects?: number;
    needsOnboarding?: boolean;
  };
}

export interface ProjectMountsPayload {
  schemaVersion: number;
  projects: Record<string, { root?: string; docsRoot?: string; prototypes?: Record<string, string> }>;
}

export interface ProjectHealthIssue {
  category: string;
  severity: 'error' | 'warning';
  code: string;
  object: string;
  message: string;
  suggestion: string;
}

export interface ProjectHealthItem {
  project: { id: string; name: string; mounted?: boolean };
  mounts: Record<string, unknown> | null;
  summary: Record<string, string | number> & { status: 'healthy' | 'warning' | 'error' };
  issues: ProjectHealthIssue[];
}

export interface ProjectHealthReport {
  generatedAt: string;
  summary: Record<string, number>;
  projects: ProjectHealthItem[];
}

export const PLATFORM_ERROR_CODES: Readonly<Record<PlatformErrorCode, PlatformErrorCode>>;
export function isRecord(value: unknown): value is Record<string, unknown>;
export function errorCodeForStatus(status: number): PlatformErrorCode;
export function createApiError(
  payload: unknown,
  options?: { status?: number; fallbackMessage?: string; cause?: unknown },
): PlatformApiError;
export function createStaticReadOnlyError(message: string): PlatformApiError;
export function assertSuccessPayload<T extends Record<string, unknown>>(
  payload: unknown,
  fallbackMessage?: string,
): T;
export function normalizePagePrdLinks(payload: unknown): PagePrdLinks;
export function normalizePrdBindings(payload: unknown): PrdBindingsPayload;
export function normalizeDocumentManifest(payload: unknown): DocumentManifest;
export function normalizeProjectScanResult(payload: unknown): ProjectScanResult;
export function normalizeHtmlPageCatalog(payload: unknown): HtmlPageCatalog;
export function normalizePlatformSettings(payload: unknown): PlatformSettings;
export function normalizeRouteList(payload: unknown): RouteListResult;
export function normalizeBootstrapState(payload: unknown): BootstrapState;
export function normalizeShareStatus(payload: unknown): ShareStatus;
export function normalizeProjectHealthReport(payload: unknown): ProjectHealthReport;
export function normalizeProjectMountsPayload(payload: unknown): ProjectMountsPayload;
