import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { ProjectManifest } from '../../../../../packages/platform-contracts/src/index.js';
import { platformApi } from '@/data/platform-api';
import { platformQueryKeys, useBootstrapState } from '@/data/use-platform-data';
import { Alert, Button, Flex, Modal, Space, Typography } from '@/ui/ant';
import { FolderOpenOutlined, PlusOutlined } from '@/ui/ant/icons';
import { ProjectMountDialog } from './ProjectMountDialog';

const { Paragraph, Text, Title } = Typography;
const DISMISSED_KEY = 'product-experience-center:onboarding-dismissed';

export function WorkspaceOnboarding() {
  const queryClient = useQueryClient();
  const bootstrap = useBootstrapState();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED_KEY) === '1');
  const [mountOpen, setMountOpen] = useState(false);
  const example = useMutation({
    mutationFn: () => platformApi.installExampleProject(),
    onSuccess: () => refreshWorkspace(),
  });

  async function refreshWorkspace(_project?: ProjectManifest) {
    localStorage.removeItem(DISMISSED_KEY);
    setDismissed(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: platformQueryKeys.bootstrap }),
      queryClient.invalidateQueries({ queryKey: platformQueryKeys.projects }),
      queryClient.invalidateQueries({ queryKey: platformQueryKeys.htmlPages }),
      queryClient.invalidateQueries({ queryKey: platformQueryKeys.mounts }),
      queryClient.invalidateQueries({ queryKey: platformQueryKeys.health }),
    ]);
  }

  const show = Boolean(
    bootstrap.data?.runtime.writeEnabled && bootstrap.data.workspace.needsOnboarding && !dismissed,
  );
  return (
    <>
      <Modal open={show} closable={false} footer={null} width={680} title={null}>
        <Space direction="vertical" size={24} style={{ width: '100%' }}>
          <div>
            <Text type="secondary">首次启动</Text>
            <Title level={2} style={{ marginTop: 6 }}>
              准备你的产品体验工作区
            </Title>
            <Paragraph type="secondary">
              当前没有可用项目。你可以挂载已有项目文件夹、安装脱敏示例，或者先进入空平台。
            </Paragraph>
          </div>
          {bootstrap.data?.workspace.invalidProjects ? (
            <Alert
              type="warning"
              showIcon
              title={`发现 ${bootstrap.data.workspace.invalidProjects} 个无效项目`}
              description="进入项目包管理或健康检查中心，可以看到具体错误和修复建议。"
            />
          ) : null}
          {example.isError ? (
            <Alert type="error" showIcon title="示例创建失败" description={example.error.message} />
          ) : null}
          <Flex vertical gap={10}>
            <Button
              type="primary"
              size="large"
              icon={<FolderOpenOutlined />}
              onClick={() => setMountOpen(true)}
            >
              打开现有项目
            </Button>
            <Button
              size="large"
              icon={<PlusOutlined />}
              loading={example.isPending}
              onClick={() => example.mutate()}
            >
              创建脱敏示例
            </Button>
            <Button
              type="text"
              onClick={() => {
                localStorage.setItem(DISMISSED_KEY, '1');
                setDismissed(true);
              }}
            >
              暂不配置，进入空平台
            </Button>
          </Flex>
          <Text type="secondary">“暂不配置”只记录在当前浏览器，不写入项目目录。</Text>
        </Space>
      </Modal>
      <ProjectMountDialog
        open={mountOpen}
        onCancel={() => setMountOpen(false)}
        onMounted={refreshWorkspace}
      />
    </>
  );
}
