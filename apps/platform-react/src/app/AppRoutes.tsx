import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { PlatformShell } from '@/routes/PlatformShell';
import { Spin } from '@/ui/ant';

const ComponentGalleryPage = lazy(() =>
  import('@/pages/ComponentGalleryPage').then((module) => ({ default: module.ComponentGalleryPage })),
);
const ProjectPackagesPage = lazy(() =>
  import('@/pages/ProjectPackagesPage').then((module) => ({ default: module.ProjectPackagesPage })),
);
const ConsolePage = lazy(() =>
  import('@/pages/ConsolePage').then((module) => ({ default: module.ConsolePage })),
);
const ProjectRoutesPage = lazy(() =>
  import('@/pages/ProjectRoutesPage').then((module) => ({ default: module.ProjectRoutesPage })),
);
const AiContextPage = lazy(() =>
  import('@/pages/AiContextPage').then((module) => ({ default: module.AiContextPage })),
);
const ProjectHealthPage = lazy(() =>
  import('@/pages/ProjectHealthPage').then((module) => ({ default: module.ProjectHealthPage })),
);
const HomePage = lazy(() => import('@/pages/HomePage').then((module) => ({ default: module.HomePage })));
const ClientLoginPage = lazy(() =>
  import('@/pages/ClientLoginPage').then((module) => ({ default: module.ClientLoginPage })),
);
const ClientWorkspacePage = lazy(() =>
  import('@/pages/ClientWorkspacePage').then((module) => ({ default: module.ClientWorkspacePage })),
);
const DocsCenterPage = lazy(() =>
  import('@/pages/DocsCenterPage').then((module) => ({ default: module.DocsCenterPage })),
);
const ProjectMobilePage = lazy(() =>
  import('@/pages/ProjectMobilePage').then((module) => ({ default: module.ProjectMobilePage })),
);
const ProjectUnavailablePage = lazy(() =>
  import('@/pages/ProjectUnavailablePage').then((module) => ({ default: module.ProjectUnavailablePage })),
);
const NotFoundPage = lazy(() =>
  import('@/pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })),
);
const ProjectRootRedirectPage = lazy(() =>
  import('@/pages/LegacyRoutePage').then((module) => ({ default: module.ProjectRootRedirectPage })),
);
const LegacyProjectEntryPage = lazy(() =>
  import('@/pages/LegacyRoutePage').then((module) => ({ default: module.LegacyProjectEntryPage })),
);
const LegacyClientRoutePage = lazy(() =>
  import('@/pages/LegacyRoutePage').then((module) => ({ default: module.LegacyClientRoutePage })),
);

const homeAliases = [
  'home-skins',
  'home-legacy',
  'variant-a',
  'variant-b',
  'variant-c',
  'variant-d',
  'variant-e',
  'variant-f',
  'variant-g',
  'variant-h',
  'variant-i',
  'variant-j',
  'variant-k',
  'variant-v',
];

export function AppRoutes() {
  return (
    <Suspense
      fallback={
        <div className="app-route-loading">
          <Spin size="large" />
        </div>
      }
    >
      <Routes>
        <Route index element={<HomePage />} />
        {/* 兼容静态服务器常见的 /index.html 入口，统一回到应用根路由。 */}
        <Route path="index.html" element={<Navigate to="/" replace />} />
        {homeAliases.map((path) => (
          <Route key={path} path={path} element={<Navigate to="/" replace />} />
        ))}
        <Route path="unavailable/:projectId" element={<ProjectUnavailablePage />} />
        <Route path="not-found" element={<NotFoundPage />} />
        <Route path="p/:projectId" element={<ProjectRootRedirectPage />} />
        <Route path="p/:projectId/docs" element={<DocsCenterPage />} />
        <Route path="p/:projectId/mobile" element={<ProjectMobilePage />} />
        <Route path="p/:projectId/:clientId/login" element={<ClientLoginPage />} />
        <Route path="p/:projectId/:clientId" element={<ClientWorkspacePage />} />
        <Route path="p/:projectId/:clientId/:pagePath" element={<ClientWorkspacePage />} />
        <Route element={<PlatformShell />}>
          <Route path="tools/console" element={<ConsolePage />} />
          <Route path="tools/projects" element={<ProjectPackagesPage />} />
          <Route path="tools/project-routes" element={<ProjectRoutesPage />} />
          <Route path="tools/ai-context" element={<AiContextPage />} />
          <Route path="tools/project-health" element={<ProjectHealthPage />} />
          <Route path="projects" element={<Navigate to="/tools/projects" replace />} />
          <Route path="components" element={<ComponentGalleryPage />} />
        </Route>
        <Route path="docs" element={<LegacyProjectEntryPage kind="docs" />} />
        <Route path="mobile" element={<LegacyProjectEntryPage kind="mobile" />} />
        <Route path="p/:projectId/*" element={<ProjectUnavailablePage />} />
        <Route path=":clientId/*" element={<LegacyClientRoutePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
