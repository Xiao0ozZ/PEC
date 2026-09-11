import { useState } from 'react';

import {
  Alert,
  Button,
  Descriptions,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from '@/ui/ant';
import {
  CheckCircleFilled,
  ExperimentOutlined,
  FormOutlined,
  InfoCircleOutlined,
  SettingOutlined,
  TableOutlined,
} from '@/ui/ant/icons';
import { PlatformPage } from '@/ui/platform/PlatformPage';
import { Surface } from '@/ui/platform/Surface';

const { Text, Title } = Typography;

const componentRows = [
  {
    name: '项目包状态',
    area: '数据管理',
    status: '稳定',
    statusColor: 'success',
    use: '项目清单、异常状态与编辑入口',
  },
  {
    name: '路由菜单管理',
    area: '配置管理',
    status: '稳定',
    statusColor: 'success',
    use: '分组、排序、页面关联与备份',
  },
  {
    name: '页面导入导出',
    area: '工程工具',
    status: '受控',
    statusColor: 'processing',
    use: '检查、确认、进度与导出结果',
  },
  {
    name: 'AI 上下文中心',
    area: '交付协作',
    status: '迭代中',
    statusColor: 'warning',
    use: 'PRD 覆盖、影响分析与上下文导出',
  },
];

export function ComponentGalleryPage() {
  const [status, setStatus] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const visibleRows = componentRows.filter((item) => status === 'all' || item.status === status);

  return (
    <PlatformPage
      title="组件规范"
      description="React 平台的公共控件统一基于 Ant Design；项目业务页面与项目包内容不在此修改。"
      actions={
        <Button type="primary" icon={<ExperimentOutlined />} onClick={() => setDialogOpen(true)}>
          查看交互范例
        </Button>
      }
    >
      <Alert
        showIcon
        type="info"
        title="单一组件来源"
        description="表单、表格、弹窗、反馈与导航控件均从平台 Ant 适配层使用，避免同类交互出现多套样式。"
      />
      <Descriptions
        className="gallery-overview"
        bordered
        column={{ xs: 1, sm: 1, md: 3 }}
        items={[
          {
            key: 'source',
            label: '组件来源',
            children: (
              <>
                <CheckCircleFilled /> Ant Design 适配层
              </>
            ),
          },
          {
            key: 'form',
            label: '表单规范',
            children: (
              <>
                <FormOutlined /> 统一校验与操作位置
              </>
            ),
          },
          {
            key: 'data',
            label: '数据展示',
            children: (
              <>
                <TableOutlined /> 紧凑表格优先
              </>
            ),
          },
        ]}
      />
      <Surface className="gallery-surface">
        <header className="surface-heading">
          <div>
            <Title level={3}>操作与状态</Title>
            <Text type="secondary">主操作明确、危险操作可辨认，状态只表达当前业务含义。</Text>
          </div>
          <ExperimentOutlined className="surface-heading__icon" />
        </header>
        <div className="gallery-action-row">
          <div>
            <Text>操作层级</Text>
            <Space wrap size={[10, 10]}>
              <Button type="primary">保存变更</Button>
              <Button>取消</Button>
              <Button icon={<SettingOutlined />}>工具操作</Button>
              <Button danger>删除</Button>
            </Space>
          </div>
          <div>
            <Text>业务状态</Text>
            <Space wrap size={[8, 8]}>
              <Tag color="success">可用</Tag>
              <Tag color="processing">处理中</Tag>
              <Tag color="warning">待确认</Tag>
              <Tag color="error">异常</Tag>
            </Space>
          </div>
        </div>
      </Surface>
      <Surface className="gallery-surface">
        <header className="surface-heading">
          <div>
            <Title level={3}>表单与配置</Title>
            <Text type="secondary">字段标签、辅助说明和开关状态保持同一阅读顺序。</Text>
          </div>
          <FormOutlined className="surface-heading__icon" />
        </header>
        <Form className="gallery-form" layout="vertical" requiredMark={false}>
          <Form.Item label="名称" required extra="给使用者能直接理解的名称。">
            <Input defaultValue="RIMO Rental" />
          </Form.Item>
          <Form.Item label="状态">
            <Select
              defaultValue="published"
              options={[
                { value: 'published', label: '已发布' },
                { value: 'draft', label: '草稿' },
              ]}
            />
          </Form.Item>
          <div className="gallery-switch-row">
            <div>
              <strong>在入口中显示</strong>
              <Text type="secondary">关闭后，该内容不会在默认入口展示。</Text>
            </div>
            <Switch checked={enabled} onChange={setEnabled} />
          </div>
        </Form>
      </Surface>
      <Surface className="gallery-surface">
        <header className="surface-heading">
          <div>
            <Title level={3}>数据表格</Title>
            <Text type="secondary">清单型任务以表格为主；筛选、状态和行操作在同一工作区完成。</Text>
          </div>
        </header>
        <Flex className="gallery-table-toolbar" gap={12} wrap="wrap">
          <Input.Search className="gallery-search" placeholder="搜索公共页面或控件" />
          <Select
            value={status}
            onChange={setStatus}
            options={[
              { label: '全部状态', value: 'all' },
              { label: '稳定', value: '稳定' },
              { label: '受控', value: '受控' },
              { label: '迭代中', value: '迭代中' },
            ]}
          />
        </Flex>
        <Table
          rowKey="name"
          pagination={false}
          columns={[
            { title: '页面', dataIndex: 'name' },
            { title: '区域', dataIndex: 'area' },
            { title: '推荐用法', dataIndex: 'use', responsive: ['md'] },
            {
              title: '状态',
              dataIndex: 'status',
              width: 110,
              render: (value, row) => <Tag color={row.statusColor}>{value}</Tag>,
            },
            { title: '操作', render: () => <Button type="link">查看</Button> },
          ]}
          dataSource={visibleRows}
        />
      </Surface>
      <Modal
        title="交互范例"
        open={dialogOpen}
        onCancel={() => setDialogOpen(false)}
        onOk={() => setDialogOpen(false)}
        okText="确认"
        cancelText="取消"
      >
        <Space direction="vertical" size={12}>
          <Flex align="center" gap={10}>
            <InfoCircleOutlined className="gallery-dialog-icon" />
            <Text>弹窗用于需要用户确认或集中完成的小范围配置。</Text>
          </Flex>
          <Text type="secondary">
            复杂项目配置使用固定头部、可滚动内容区和稳定底部操作，避免按钮随内容漂移。
          </Text>
        </Space>
      </Modal>
    </PlatformPage>
  );
}
