import { useMemo } from 'react';
import type { ColumnsType } from 'antd/es/table';

import type {
  ProjectHealthIssue,
  ProjectHealthItem,
} from '../../../../packages/platform-contracts/src/index.js';
import { useProjectHealth } from '@/data/use-platform-data';
import { Alert, Button, Collapse, Empty, Flex, Spin, Statistic, Table, Tag, Typography } from '@/ui/ant';
import { CheckCircleFilled, ReloadOutlined, WarningFilled } from '@/ui/ant/icons';
import { PlatformPage } from '@/ui/platform/PlatformPage';
import { Surface } from '@/ui/platform/Surface';

const { Text, Title } = Typography;
const categoryNames: Record<string, string> = {
  manifest: '项目配置',
  schema: 'Schema',
  routes: '路由与菜单',
  html: 'HTML 原型',
  documents: 'PRD 文档',
  associations: '需求关联',
  resources: '项目资源',
  mounts: '目录挂载',
};

export function ProjectHealthPage() {
  const query = useProjectHealth();
  const report = query.data;
  const columns = useMemo<ColumnsType<ProjectHealthIssue>>(
    () => [
      {
        title: '级别',
        dataIndex: 'severity',
        width: 86,
        render: (severity) => (
          <Tag color={severity === 'error' ? 'error' : 'warning'}>
            {severity === 'error' ? '错误' : '提醒'}
          </Tag>
        ),
      },
      { title: '范围', dataIndex: 'category', width: 110, render: (value) => categoryNames[value] || value },
      { title: '影响对象', dataIndex: 'object', width: 180, render: (value) => <code>{value}</code> },
      {
        title: '问题与建议',
        key: 'message',
        render: (_, item) => (
          <div>
            <Text>{item.message}</Text>
            <small className="table-secondary">建议：{item.suggestion}</small>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <PlatformPage
      title="项目健康检查"
      description="集中检查项目配置、页面、HTML、PRD、关联、资源、挂载和 Schema。"
      actions={
        <Button icon={<ReloadOutlined />} loading={query.isFetching} onClick={() => void query.refetch()}>
          重新扫描
        </Button>
      }
    >
      {query.isError ? (
        <Alert type="error" showIcon title="健康检查失败" description={query.error.message} />
      ) : null}
      {query.isPending ? (
        <div className="page-loading">
          <Spin size="large" />
        </div>
      ) : null}
      {report ? (
        <>
          <Surface className="packages-summary">
            <Flex className="packages-summary__stats" gap={0}>
              <Statistic title="项目" value={report.summary.projects || 0} suffix="个" />
              <Statistic title="健康" value={report.summary.healthy || 0} suffix="个" />
              <Statistic
                title="错误"
                value={report.summary.errors || 0}
                styles={{ content: { color: report.summary.errors ? '#cf1322' : undefined } }}
              />
              <Statistic
                title="提醒"
                value={report.summary.warnings || 0}
                styles={{ content: { color: report.summary.warnings ? '#d46b08' : undefined } }}
              />
            </Flex>
          </Surface>
          <Surface className="health-projects">
            <div className="workspace-section-heading">
              <div>
                <Title level={3}>检查结果</Title>
                <Text type="secondary">每条问题都保留影响对象和可执行建议，不再只显示“项目不可用”。</Text>
              </div>
              <Text type="secondary">
                {report.generatedAt ? new Date(report.generatedAt).toLocaleString() : ''}
              </Text>
            </div>
            {report.projects.length ? (
              <Collapse
                items={report.projects.map((item: ProjectHealthItem) => ({
                  key: item.project.id,
                  label: <ProjectHealthLabel item={item} />,
                  children: item.issues.length ? (
                    <Table
                      rowKey={(issue) => `${issue.code}:${issue.object}`}
                      columns={columns}
                      dataSource={item.issues}
                      pagination={false}
                      size="small"
                    />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未发现问题" />
                  ),
                }))}
              />
            ) : (
              <Empty description="当前没有项目可检查" />
            )}
          </Surface>
        </>
      ) : null}
    </PlatformPage>
  );
}

function ProjectHealthLabel({ item }: { item: ProjectHealthItem }) {
  const healthy = item.summary.status === 'healthy';
  return (
    <Flex align="center" gap={10} wrap="wrap">
      {healthy ? (
        <CheckCircleFilled style={{ color: '#52c41a' }} />
      ) : (
        <WarningFilled style={{ color: item.summary.status === 'error' ? '#ff4d4f' : '#faad14' }} />
      )}
      <Text strong>{item.project.name}</Text>
      <Text type="secondary">{item.project.id}</Text>
      {item.project.mounted ? <Tag color="blue">外部挂载</Tag> : null}
      <Tag color={healthy ? 'success' : item.summary.status === 'error' ? 'error' : 'warning'}>
        {healthy ? '健康' : `${item.summary.errors} 错误 / ${item.summary.warnings} 提醒`}
      </Tag>
    </Flex>
  );
}
