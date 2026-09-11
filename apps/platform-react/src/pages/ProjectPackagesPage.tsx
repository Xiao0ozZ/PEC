import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import { useLocation, useNavigate } from 'react-router-dom';

import type { InvalidProject, ProjectManifest } from '../../../../packages/platform-contracts/src/index.js';
import { platformApi } from '@/data/platform-api';
import { platformQueryKeys, useBootstrapState, useProjectManifest } from '@/data/use-platform-data';
import { ProjectConfigDialog } from '@/features/projects/ProjectConfigDialog';
import { ProjectMountDialog } from '@/features/projects/ProjectMountDialog';
import { Alert, Button, Empty, Flex, Modal, Space, Spin, Statistic, Table, Tag, Typography } from '@/ui/ant';
import {
  DisconnectOutlined,
  EditOutlined,
  LinkOutlined,
  OrderedListOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@/ui/ant/icons';
import { PlatformPage } from '@/ui/platform/PlatformPage';
import { Surface } from '@/ui/platform/Surface';

const { Text, Title } = Typography;

function projectDescription(project: ProjectManifest) {
  return project.description || '暂无项目说明';
}

export function ProjectPackagesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const manifestQuery = useProjectManifest();
  const bootstrapQuery = useBootstrapState();
  const projects = manifestQuery.data?.projects ?? [];
  const invalidProjects = manifestQuery.data?.invalidProjects ?? [];
  const [notice, setNotice] = useState('');
  const [mountOpen, setMountOpen] = useState(false);
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit'; project: ProjectManifest | null } | null>(
    null,
  );
  const canManageProjects = Boolean(platformApi.development && bootstrapQuery.data?.runtime.writeEnabled);
  const requestedProjectId = new URLSearchParams(location.search).get('project') || '';
  const requestedEdit = new URLSearchParams(location.search).get('edit') === '1';
  const selectedProject = projects.find((project) => project.id === requestedProjectId) ?? null;
  const openDialog =
    dialog || (requestedEdit && selectedProject ? { mode: 'edit' as const, project: selectedProject } : null);
  const saveProject = useMutation({
    mutationFn: (payload: { data: Record<string, unknown>; editing: boolean }) =>
      platformApi.saveProject(payload.data, { editing: payload.editing }),
    onSuccess: async (result) => {
      setNotice(`${result.message || '项目配置已保存。'} 开发服务正在重新载入项目配置。`);
      setDialog(null);
      await queryClient.invalidateQueries({ queryKey: platformQueryKeys.projects });
      await queryClient.invalidateQueries({ queryKey: platformQueryKeys.htmlPages });
    },
  });
  const unmountProject = useMutation({
    mutationFn: (projectId: string) => platformApi.unmountProject(projectId),
    onSuccess: async (result) => {
      setNotice(String(result.message || '挂载已取消。'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: platformQueryKeys.projects }),
        queryClient.invalidateQueries({ queryKey: platformQueryKeys.htmlPages }),
        queryClient.invalidateQueries({ queryKey: platformQueryKeys.mounts }),
        queryClient.invalidateQueries({ queryKey: platformQueryKeys.health }),
      ]);
    },
  });

  const columns = useMemo<ColumnsType<ProjectManifest>>(
    () => [
      {
        title: '项目名称',
        dataIndex: 'name',
        key: 'name',
        minWidth: 180,
        render: (name: string, project) => (
          <div>
            <Text strong>{name}</Text>
            <small className="table-secondary">{projectDescription(project)}</small>
          </div>
        ),
      },
      { title: '项目 ID', dataIndex: 'id', key: 'id', width: 160, render: (value) => <code>{value}</code> },
      {
        title: '版本',
        dataIndex: 'version',
        key: 'version',
        width: 100,
        render: (value) => <code>v{value || '1.0'}</code>,
      },
      {
        title: '客户端',
        dataIndex: 'clients',
        key: 'clients',
        minWidth: 210,
        render: (clients: ProjectManifest['clients']) =>
          clients.length ? (
            clients.map((client) => <Tag key={client.id}>{client.name}</Tag>)
          ) : (
            <Text type="secondary">-</Text>
          ),
      },
      { title: '状态', key: 'status', width: 100, render: () => <Tag color="success">可用</Tag> },
      {
        title: '首页显示',
        key: 'homepage',
        width: 110,
        render: (_, project) => (
          <Tag color={project.homepage?.visible !== false ? 'blue' : 'default'}>
            {project.homepage?.visible !== false ? '显示' : '隐藏'}
          </Tag>
        ),
      },
      ...(canManageProjects
        ? [
            {
              title: '操作',
              key: 'action',
              width: 176,
              fixed: 'right' as const,
              render: (_: unknown, project: ProjectManifest) => (
                <Space size={4}>
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => setDialog({ mode: 'edit', project })}
                  >
                    编辑
                  </Button>
                  {project.mounted ? (
                    <Button
                      size="small"
                      danger
                      icon={<DisconnectOutlined />}
                      onClick={() => {
                        Modal.confirm({
                          title: `取消挂载“${project.name}”？`,
                          content: '只移除本机挂载记录，不会删除或修改源项目文件。',
                          okText: '取消挂载',
                          okButtonProps: { danger: true },
                          cancelText: '返回',
                          onOk: () => unmountProject.mutateAsync(project.id),
                        });
                      }}
                    >
                      取消挂载
                    </Button>
                  ) : null}
                </Space>
              ),
            },
          ]
        : []),
    ],
    [canManageProjects, unmountProject],
  );

  return (
    <PlatformPage
      title="项目包管理"
      description="查看本地项目资料状态，维护项目入口、主题和客户端配置。"
      actions={
        <>
          {canManageProjects ? (
            <Button icon={<SafetyCertificateOutlined />} onClick={() => navigate('/tools/project-health')}>
              健康检查
            </Button>
          ) : null}
          {canManageProjects ? (
            <Button icon={<OrderedListOutlined />} onClick={() => navigate('/tools/project-routes')}>
              路由菜单
            </Button>
          ) : null}
          <Button
            icon={<ReloadOutlined />}
            loading={manifestQuery.isFetching}
            onClick={() => void manifestQuery.refetch()}
          >
            重新扫描
          </Button>
          {canManageProjects ? (
            <Button icon={<LinkOutlined />} onClick={() => setMountOpen(true)}>
              挂载项目
            </Button>
          ) : null}
          {canManageProjects ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setDialog({ mode: 'create', project: null })}
            >
              新建项目
            </Button>
          ) : null}
        </>
      }
    >
      {manifestQuery.isError ? (
        <Alert type="error" showIcon title="项目包读取失败" description={manifestQuery.error.message} />
      ) : null}
      {notice ? (
        <Alert type="success" showIcon closable={{ onClose: () => setNotice('') }} title={notice} />
      ) : null}
      {saveProject.isError ? (
        <Alert
          type="error"
          showIcon
          closable={{ onClose: saveProject.reset }}
          title="项目配置保存失败"
          description={saveProject.error.message}
        />
      ) : null}
      {unmountProject.isError ? (
        <Alert
          type="error"
          showIcon
          closable={{ onClose: unmountProject.reset }}
          title="取消挂载失败"
          description={unmountProject.error.message}
        />
      ) : null}

      <Surface className="packages-summary" aria-label="项目包概览">
        <Flex className="packages-summary__stats" gap={0}>
          <Statistic title="可用项目" value={projects.length} suffix="个" />
          <Statistic
            title="异常项目"
            value={invalidProjects.length}
            suffix="个"
            styles={invalidProjects.length ? { content: { color: '#d46b08' } } : undefined}
          />
          <Statistic title="当前权限" value={canManageProjects ? '可管理' : '只读'} />
        </Flex>
      </Surface>

      <Surface className="packages-table-panel">
        <div className="workspace-section-heading">
          <div>
            <Title level={3}>项目清单</Title>
            <Text type="secondary">有效项目可直接进入首页和配置流程。</Text>
          </div>
          <Tag color="blue">{projects.length} 个项目</Tag>
        </div>
        {manifestQuery.isPending ? (
          <div className="page-loading">
            <Spin size="large" />
          </div>
        ) : projects.length ? (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={projects}
            pagination={false}
            size="middle"
            scroll={{ x: 820 }}
          />
        ) : (
          <Empty description="尚未发现有效项目包" />
        )}
      </Surface>

      {invalidProjects.length ? (
        <InvalidProjectPanel
          projects={invalidProjects}
          editable={canManageProjects}
          onEdit={(project) => setDialog({ mode: 'edit', project })}
        />
      ) : null}
      {openDialog ? (
        <ProjectConfigDialog
          key={`${openDialog.mode}:${openDialog.project?.id || 'new'}`}
          open
          mode={openDialog.mode}
          project={openDialog.project}
          projectIds={projects.map((project) => project.id)}
          saving={saveProject.isPending}
          onCancel={() => setDialog(null)}
          onSave={async (data) => {
            await saveProject.mutateAsync({ data, editing: openDialog.mode === 'edit' });
          }}
        />
      ) : null}
      <ProjectMountDialog
        open={mountOpen}
        onCancel={() => setMountOpen(false)}
        onMounted={async () => {
          setNotice('项目已挂载，源文件保持在原目录。');
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: platformQueryKeys.projects }),
            queryClient.invalidateQueries({ queryKey: platformQueryKeys.htmlPages }),
            queryClient.invalidateQueries({ queryKey: platformQueryKeys.mounts }),
            queryClient.invalidateQueries({ queryKey: platformQueryKeys.health }),
          ]);
        }}
      />
    </PlatformPage>
  );
}

function InvalidProjectPanel({
  projects,
  editable,
  onEdit,
}: {
  projects: InvalidProject[];
  editable: boolean;
  onEdit: (project: ProjectManifest) => void;
}) {
  const columns: ColumnsType<InvalidProject> = [
    { title: '文件夹', dataIndex: 'folder', key: 'folder', width: 220 },
    { title: '问题', dataIndex: 'errors', key: 'errors', render: (errors: string[]) => errors.join('；') },
    ...(editable
      ? [
          {
            title: '操作',
            key: 'action',
            width: 120,
            render: (_: unknown, item: InvalidProject) =>
              item.project ? (
                <Button size="small" onClick={() => onEdit(item.project as ProjectManifest)}>
                  配置
                </Button>
              ) : (
                <Text type="secondary">无法读取配置</Text>
              ),
          },
        ]
      : []),
  ];
  return (
    <Surface className="invalid-project-panel">
      <div className="workspace-section-heading">
        <Title level={3}>无效项目包</Title>
        <Tag color="warning">{projects.length} 个需要处理</Tag>
      </div>
      <Table rowKey="folder" columns={columns} dataSource={projects} pagination={false} scroll={{ x: 600 }} />
    </Surface>
  );
}
