import { useMutation, useQueryClient } from '@tanstack/react-query';

import { platformApi } from '@/data/platform-api';
import { platformQueryKeys, useShareStatus } from '@/data/use-platform-data';
import { Alert, Button, Flex, Switch, Tag, Tooltip, Typography } from '@/ui/ant';
import { CopyOutlined, GlobalOutlined } from '@/ui/ant/icons';
import { Surface } from '@/ui/platform/Surface';

const { Text, Title } = Typography;

function shareHint(status: { managedByStartup: boolean; canControl: boolean; readOnly: boolean }) {
  if (status.managedByStartup) return '服务以局域网地址启动，分享状态由启动参数决定。';
  if (status.readOnly) return '当前服务为只读模式，不能切换分享。';
  if (!status.canControl) return '只有服务主机可以切换分享状态。';
  return '开启后同一网络的设备可只读查看项目、原型和 PRD；写入始终只属于服务主机。';
}

export function ShareControlPanel() {
  const queryClient = useQueryClient();
  const shareQuery = useShareStatus();
  const status = shareQuery.data;
  const toggleShare = useMutation({
    mutationFn: (enabled: boolean) => platformApi.saveShareEnabled(enabled),
    onSuccess: (next) => queryClient.setQueryData(platformQueryKeys.share, next),
  });

  if (!platformApi.development) return null;
  if (shareQuery.isError) {
    return (
      <Surface className="console-share-panel">
        <Alert
          type="info"
          showIcon
          title="局域网分享不可用"
          description="当前平台由开发服务器或静态部署承载，未提供分享控制接口。使用 npm run serve:local 启动独立服务后可用。"
        />
      </Surface>
    );
  }

  const sharing = status?.sharing ?? false;
  const lanUrls = status?.urls.lan ?? [];

  return (
    <Surface className="console-share-panel">
      <div>
        <Flex align="center" gap={8}>
          <Title level={3}>局域网只读分享</Title>
          <Tag color={sharing ? 'success' : 'default'}>{sharing ? '已开启' : '已关闭'}</Tag>
        </Flex>
        <Text type="secondary">{status ? shareHint(status) : '正在读取分享状态…'}</Text>
        {status?.urls.local ? (
          <div className="console-share-panel__urls">
            <Text type="secondary">本机地址</Text>
            <Text code>{status.urls.local}</Text>
          </div>
        ) : null}
        {sharing && lanUrls.length ? (
          <div className="console-share-panel__urls">
            <Text type="secondary">可分享地址</Text>
            {lanUrls.map((url) => (
              <Flex key={url} align="center" gap={6}>
                <GlobalOutlined />
                <Text code>{url}</Text>
                <Tooltip title="复制地址">
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => void navigator.clipboard?.writeText(url)}
                  />
                </Tooltip>
              </Flex>
            ))}
          </div>
        ) : null}
        {sharing && !lanUrls.length ? (
          <Text type="warning">已开启分享，但未检测到可用的局域网地址。</Text>
        ) : null}
      </div>
      <Switch
        checked={sharing}
        loading={shareQuery.isPending || toggleShare.isPending}
        disabled={!status?.canControl}
        checkedChildren="开"
        unCheckedChildren="关"
        onChange={(checked) => toggleShare.mutate(checked)}
      />
      {toggleShare.isError ? (
        <Alert
          type="error"
          showIcon
          closable={{ onClose: toggleShare.reset }}
          title="分享状态切换失败"
          description={toggleShare.error.message}
        />
      ) : null}
    </Surface>
  );
}
