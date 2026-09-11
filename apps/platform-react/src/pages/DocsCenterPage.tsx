import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import type { DocumentEntry } from '../../../../packages/platform-contracts/src/index.js';
import { platformApi } from '@/data/platform-api';
import {
  useDocumentManifest,
  useHtmlPageCatalog,
  usePagePrdLinks,
  useProjectManifest,
} from '@/data/use-platform-data';
import { findProject } from '@/features/projects/project-model';
import { MarkdownReader } from '@/features/docs/MarkdownReader';
import { resolveDocumentAssetPath, type MarkdownHeading } from '@/features/docs/markdown';
import { Button, Collapse, Empty, Input, Layout, List, Spin, Tag, Typography } from '@/ui/ant';
import { ArrowLeftOutlined, FileTextOutlined, LinkOutlined } from '@/ui/ant/icons';
import { ThemeControl } from '@/ui/platform/ThemeControl';

const { Text } = Typography;
const { Header, Sider, Content } = Layout;

function getDocumentName(document: DocumentEntry) {
  const fallback = document.path.split('/').pop()?.replace(/\.md$/iu, '') || '未命名文档';
  const fileName = typeof document.fileName === 'string' ? document.fileName : fallback;
  return document.title || fileName;
}

function getDocumentFolders(document: DocumentEntry) {
  if (!Array.isArray(document.folders)) return [];
  return document.folders.filter((folder): folder is string => typeof folder === 'string' && Boolean(folder));
}

export function DocsCenterPage() {
  const navigate = useNavigate();
  const { projectId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectQuery = useProjectManifest();
  const htmlCatalogQuery = useHtmlPageCatalog();
  const project = findProject(projectQuery.data?.projects ?? [], projectId);
  const manifestQuery = useDocumentManifest(projectId, project?.docs?.enabled !== false);
  const pagePrdLinksQuery = usePagePrdLinks(projectId, Boolean(project));
  const [filter, setFilter] = useState('');
  const [headings, setHeadings] = useState<MarkdownHeading[]>([]);
  const [activeHeadingId, setActiveHeadingId] = useState('');
  const documents = useMemo(() => manifestQuery.data?.documents ?? [], [manifestQuery.data]);
  const selectedPath = searchParams.get('doc') || searchParams.get('file') || documents[0]?.path || '';
  const selectedAnchor = searchParams.get('anchor') || '';
  const selectedDocument = documents.find((document) => document.path === selectedPath) ?? null;
  const activeOutlineHeadingId =
    activeHeadingId && headings.some((heading) => heading.id === activeHeadingId)
      ? activeHeadingId
      : selectedAnchor && headings.some((heading) => heading.id === selectedAnchor)
        ? selectedAnchor
        : headings[0]?.id || '';
  const documentQuery = useQuery({
    queryKey: ['platform', 'document', projectId, selectedPath],
    queryFn: () => platformApi.loadDocument(projectId, selectedPath),
    enabled: Boolean(projectId && selectedPath),
  });
  const filteredDocuments = useMemo(
    () =>
      documents.filter((document) =>
        `${getDocumentName(document)} ${getDocumentFolders(document).join(' ')}`
          .toLowerCase()
          .includes(filter.trim().toLowerCase()),
      ),
    [documents, filter],
  );
  const documentGroups = useMemo(() => {
    const groups = new Map<string, DocumentEntry[]>();
    filteredDocuments.forEach((document) => {
      const folders = getDocumentFolders(document);
      const key = folders.length ? folders.join(' / ') : '未分类';
      const current = groups.get(key) ?? [];
      current.push(document);
      groups.set(key, current);
    });
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'zh-Hans-CN', { numeric: true }))
      .map(([label, groupDocuments]) => ({ label, documents: groupDocuments }));
  }, [filteredDocuments]);
  const associatedPages = useMemo(() => {
    if (!project || !selectedPath) return [];
    const projectPages = htmlCatalogQuery.data?.projects?.[projectId] ?? {};
    return Object.entries(pagePrdLinksQuery.data ?? {}).flatMap(([clientId, links]) =>
      Object.entries(links).flatMap(([pageName, documentPath]) => {
        if (documentPath !== selectedPath) return [];
        const page = projectPages[clientId]?.find((item) => item.name === pageName);
        if (!page) return [];
        return [
          {
            key: `${clientId}:${page.name}`,
            clientName: project.clients.find((client) => client.id === clientId)?.name || clientId,
            title: page.title,
            route: `/p/${projectId}/${clientId}/${page.path}`,
          },
        ];
      }),
    );
  }, [htmlCatalogQuery.data, pagePrdLinksQuery.data, project, projectId, selectedPath]);
  const resolveAssetUrl = useCallback(
    (assetPath: string) =>
      platformApi.getDocumentAssetUrl(projectId, resolveDocumentAssetPath(selectedPath, assetPath)),
    [projectId, selectedPath],
  );
  const openDocument = useCallback(
    (documentPath: string, anchor = '') => {
      setHeadings([]);
      setActiveHeadingId('');
      const next = new URLSearchParams({ doc: documentPath });
      if (anchor) next.set('anchor', anchor);
      setSearchParams(next);
    },
    [setSearchParams],
  );
  const resolveDocumentUrl = useCallback(
    (documentPath: string, anchor = '') => {
      const next = new URLSearchParams({ doc: documentPath });
      if (anchor) next.set('anchor', anchor);
      return `/p/${projectId}/docs?${next.toString()}`;
    },
    [projectId],
  );

  useEffect(() => {
    document.title = `${selectedDocument?.title || '产品文档'} - ${project?.name || '项目'}`;
  }, [project?.name, selectedDocument?.title]);

  useEffect(() => {
    const reader = document.querySelector<HTMLElement>('.docs-reader');
    if (!reader || !headings.length) return;
    const headingElements = headings
      .map((heading) => reader.querySelector<HTMLElement>(`#${CSS.escape(heading.id)}`))
      .filter((heading): heading is HTMLElement => Boolean(heading));
    if (!headingElements.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleHeadings = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
        const nextHeading = visibleHeadings[0]?.target as HTMLElement | undefined;
        if (nextHeading) setActiveHeadingId(nextHeading.id);
      },
      { root: reader, rootMargin: '-12% 0px -70% 0px', threshold: [0, 1] },
    );
    headingElements.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [headings, selectedPath]);

  useEffect(() => {
    if (!activeOutlineHeadingId) return;
    document
      .querySelector<HTMLElement>('.docs-outline .ant-list-item.is-active')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeOutlineHeadingId]);

  useEffect(() => {
    const legacyPath = searchParams.get('file');
    if (!legacyPath || searchParams.get('doc')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('file');
    next.set('doc', legacyPath);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  if (projectQuery.isPending)
    return (
      <div className="home-loading">
        <Spin size="large" />
      </div>
    );
  if (!project || project.homepage?.visible === false || project.docs?.enabled === false)
    return <Navigate to={`/unavailable/${projectId}`} replace />;
  if (manifestQuery.isPending)
    return (
      <div className="home-loading">
        <Spin size="large" />
      </div>
    );

  const selectDocument = (document: DocumentEntry) => openDocument(document.path);
  const selectedFolderLabel = selectedDocument
    ? getDocumentFolders(selectedDocument).join(' / ') || '未分类'
    : '文档';
  const scrollToHeading = (headingId: string) => {
    setActiveHeadingId(headingId);
    document
      .querySelector('.docs-reader')
      ?.querySelector<HTMLElement>(`#${CSS.escape(headingId)}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <Layout className="docs-center">
      <Header className="docs-header">
        <div className="docs-header__brand">
          <Button
            className="docs-header__back"
            type="text"
            icon={<ArrowLeftOutlined />}
            aria-label="返回首页"
            onClick={() => navigate('/')}
          />
          <span className="docs-header__identity-mark" aria-hidden="true">
            <FileTextOutlined />
          </span>
          <div>
            <strong>{project.name}</strong>
            <Text type="secondary">文档中心</Text>
          </div>
        </div>
        <div className="docs-header__current">产品资料</div>
        <div className="docs-header__actions">
          <Tag bordered={false}>{documents.length} 份文档</Tag>
          <ThemeControl />
          <Button type="text" onClick={() => navigate('/')}>
            返回首页
          </Button>
        </div>
      </Header>
      <Layout className="docs-layout">
        <Sider theme="light" width={292} className="docs-sidebar">
          <div className="docs-sidebar__heading">
            <div>
              <Text strong>文档目录</Text>
              <Text type="secondary">按文件夹分类</Text>
            </div>
            <Tag bordered={false}>{filteredDocuments.length}</Tag>
          </div>
          <Input.Search
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            allowClear
            placeholder="搜索文件名"
          />
          {associatedPages.length ? (
            <Collapse
              className="docs-associated-pages"
              ghost
              items={[
                {
                  key: 'pages',
                  label: `关联页面 ${associatedPages.length}`,
                  children: (
                    <List
                      size="small"
                      dataSource={associatedPages}
                      renderItem={(page) => (
                        <List.Item>
                          <Button type="text" icon={<LinkOutlined />} onClick={() => navigate(page.route)}>
                            <span>
                              {page.title}
                              <small>{page.clientName}</small>
                            </span>
                          </Button>
                        </List.Item>
                      )}
                    />
                  ),
                },
              ]}
            />
          ) : null}
          <div className="docs-file-groups">
            {documentGroups.length ? (
              documentGroups.map((group) => (
                <section className="docs-file-group" key={group.label}>
                  <div className="docs-file-group__heading">
                    <Text strong>{group.label}</Text>
                    <Text type="secondary">{group.documents.length}</Text>
                  </div>
                  <List
                    className="docs-file-list"
                    dataSource={group.documents}
                    renderItem={(document) => (
                      <List.Item className={document.path === selectedPath ? 'is-active' : ''}>
                        <Button
                          type="text"
                          block
                          title={getDocumentName(document)}
                          onClick={() => selectDocument(document)}
                        >
                          <FileTextOutlined />
                          <span className="docs-file-item__content">
                            <strong>{getDocumentName(document)}</strong>
                          </span>
                        </Button>
                      </List.Item>
                    )}
                  />
                </section>
              ))
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配文档" />
            )}
          </div>
        </Sider>
        <Content className="docs-reader">
          {selectedDocument ? (
            <div className="docs-reader__inner">
              <div className="docs-reader__breadcrumb">
                <Text type="secondary">文档</Text>
                <span aria-hidden="true">›</span>
                <Text>{selectedFolderLabel}</Text>
              </div>
              <MarkdownReader
                source={documentQuery.data ?? ''}
                loading={documentQuery.isPending}
                error={documentQuery.error instanceof Error ? documentQuery.error.message : undefined}
                onHeadings={setHeadings}
                documentPath={selectedPath}
                resolveAssetUrl={resolveAssetUrl}
                resolveDocumentUrl={resolveDocumentUrl}
                onDocumentNavigate={openDocument}
                activeAnchor={selectedAnchor}
              />
            </div>
          ) : (
            <Empty description="选择一份文档开始阅读" />
          )}
        </Content>
        <Sider theme="light" width={224} className="docs-outline">
          <div className="docs-outline__heading">
            <div>
              <Text strong>本文目录</Text>
              <Text type="secondary">按章节跳转</Text>
            </div>
            <Tag bordered={false}>{headings.length}</Tag>
          </div>
          <List
            size="small"
            dataSource={headings}
            renderItem={(heading) => (
              <List.Item
                className={heading.id === activeOutlineHeadingId ? 'is-active' : ''}
                style={{ paddingLeft: (heading.level - 1) * 10 }}
              >
                <Button type="text" block onClick={() => scrollToHeading(heading.id)}>
                  {heading.text}
                </Button>
              </List.Item>
            )}
          />
        </Sider>
      </Layout>
    </Layout>
  );
}
