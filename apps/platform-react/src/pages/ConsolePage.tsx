import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { platformApi } from '@/data/platform-api';
import { Alert, Button, Flex, List, Switch, Tag, Typography } from '@/ui/ant';
import {
  AppstoreOutlined,
  ArrowRightOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  OrderedListOutlined,
} from '@/ui/ant/icons';
import { PlatformPage } from '@/ui/platform/PlatformPage';
import { Surface } from '@/ui/platform/Surface';
import { ShareControlPanel } from '@/features/projects/ShareControlPanel';

const { Text, Title } = Typography;

const tools = [
  {
    title: '项目包管理',
    description: '管理项目资料、首页可见性、主题和客户端入口。',
    to: '/tools/projects',
    icon: <FolderOpenOutlined />,
  },
  {
    title: '路由菜单管理',
    description: '维护菜单分组、页面顺序、PRD 关联与备份。',
    to: '/tools/project-routes',
    icon: <OrderedListOutlined />,
  },
  {
    title: '页面导入导出',
    description: '检查、导入、替换或导出规范 HTML 页面。',
    to: '/tools/page-transfer',
    icon: <FileTextOutlined />,
  },
  {
    title: 'AI 上下文中心',
    description: '检查页面和 PRD 覆盖并导出交付上下文。',
    to: '/tools/ai-context',
    icon: <DatabaseOutlined />,
  },
  {
    title: '组件规范',
    description: '查看 React 平台统一使用的 Ant Design 控件。',
    to: '/components',
    icon: <AppstoreOutlined />,
  },
];

export function ConsolePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ['platform', 'settings'],
    queryFn: () => platformApi.loadPlatformSettings(),
  });
  const developerMode = settingsQuery.data?.developerMode ?? false;
  const saveSettings = useMutation({
    mutationFn: (next: boolean) => platformApi.savePlatformSettings({ developerMode: next }),
    onSuccess: (settings) => queryClient.setQueryData(['platform', 'settings'], settings),
  });
  const canPersist = platformApi.development;

  return (
    <PlatformPage
      title="控制台"
      description="管理平台级项目资料、页面路由、导入导出和交付上下文。"
      actions={
        <Tag color={canPersist ? 'processing' : 'default'}>{canPersist ? '本机开发服务' : '静态只读'}</Tag>
      }
    >
      {settingsQuery.isError ? (
        <Alert type="error" showIcon title="开发模式读取失败" description={settingsQuery.error.message} />
      ) : null}
      {saveSettings.isError ? (
        <Alert
          type="error"
          showIcon
          closable={{ onClose: saveSettings.reset }}
          title="开发模式保存失败"
          description={saveSettings.error.message}
        />
      ) : null}

      <Surface className="console-settings-panel">
        <div>
          <Flex align="center" gap={8}>
            <Title level={3}>PRD 对照开发模式</Title>
            <Tag color={developerMode ? 'success' : 'default'}>{developerMode ? '已开启' : '已关闭'}</Tag>
          </Flex>
          <Text type="secondary">开启后可在业务页面查看对应 PRD；默认不会自动打开侧窗。</Text>
          {!canPersist ? <Text type="secondary">静态部署不支持修改共享开发模式。</Text> : null}
        </div>
        <Switch
          checked={developerMode}
          loading={settingsQuery.isPending || saveSettings.isPending}
          disabled={!canPersist}
          checkedChildren="开"
          unCheckedChildren="关"
          onChange={(checked) => saveSettings.mutate(checked)}
        />
      </Surface>

      <ShareControlPanel />

      <Surface className="console-tool-list">
        <header className="workspace-section-heading">
          <div>
            <Title level={3}>平台工作区</Title>
            <Text type="secondary">选择需要处理的管理任务。</Text>
          </div>
          <Text type="secondary">{tools.length} 个入口</Text>
        </header>
        <List
          dataSource={tools}
          renderItem={(tool) => (
            <List.Item
              actions={[
                <Button
                  key="open"
                  type="text"
                  icon={<ArrowRightOutlined />}
                  onClick={() => navigate(tool.to)}
                >
                  打开
                </Button>,
              ]}
            >
              <List.Item.Meta
                avatar={<span className="console-tool-list__icon">{tool.icon}</span>}
                title={tool.title}
                description={tool.description}
              />
            </List.Item>
          )}
        />
      </Surface>
    </PlatformPage>
  );
}
