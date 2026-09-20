import type { CSSProperties } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';

import { useProjectManifest } from '@/data/use-platform-data';
import { DEFAULT_PROJECT_THEME } from '@/features/projects/project-config-model';
import { findProject } from '@/features/projects/project-model';
import { platformApi } from '@/data/platform-api';
import { Button, Result, Spin, Typography } from '@/ui/ant';
import { ThemeControl } from '@/ui/platform/ThemeControl';

const { Text } = Typography;

export function ProjectMobilePage() {
  const navigate = useNavigate();
  const { projectId = '' } = useParams();
  const projectQuery = useProjectManifest();
  const project = findProject(projectQuery.data?.projects ?? [], projectId);

  if (projectQuery.isPending)
    return (
      <div className="home-loading">
        <Spin size="large" />
      </div>
    );
  if (!project || project.homepage?.visible === false)
    return <Navigate to={`/unavailable/${projectId}`} replace />;

  const mobileEntry = project.mobile?.enabled && project.mobile.entry ? project.mobile.entry : '';
  if (mobileEntry) {
    const mobileUrl = platformApi.getProjectAssetUrl(projectId, mobileEntry);
    return (
      <main
        className="mobile-preview-page"
        style={{ '--project-accent': project.theme?.primary || DEFAULT_PROJECT_THEME.primary } as CSSProperties}
      >
        <header className="mobile-preview-header">
          <div>
            <strong>{project.name}</strong>
            <Text type="secondary">移动端原型</Text>
          </div>
          <div className="mobile-preview-actions">
            <ThemeControl />
            <Button type="text" onClick={() => navigate('/')}>
              返回首页
            </Button>
          </div>
        </header>
        <iframe
          className="mobile-preview-frame"
          src={mobileUrl}
          title={`${project.name} 移动端原型`}
          referrerPolicy="same-origin"
          onLoad={(event) => {
            try {
              const root = event.currentTarget.contentDocument?.documentElement;
              root?.style.setProperty('--brand', project.theme?.primary || DEFAULT_PROJECT_THEME.primary);
              root?.style.setProperty('--app-color-primary', project.theme?.primary || DEFAULT_PROJECT_THEME.primary);
            } catch {
              // 同源项目资源会同步主题，未来跨域时保持原页面样式。
            }
          }}
        />
      </main>
    );
  }

  return (
    <main className="system-result-page">
      <Result
        status="404"
        title="当前项目未启用独立移动端入口"
        subTitle="如移动端以普通客户端形式配置，可直接从项目入口进入。"
        extra={
          <Button type="primary" onClick={() => navigate('/')}>
            返回首页
          </Button>
        }
      />
    </main>
  );
}
