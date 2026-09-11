import { useEffect, type ReactNode } from 'react';

import { Flex, Typography } from '@/ui/ant';

const { Text, Title } = Typography;

interface PlatformPageProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function PlatformPage({ eyebrow, title, description, actions, children }: PlatformPageProps) {
  useEffect(() => {
    document.title = `${title} · 产品功能体验中心`;
  }, [title]);

  return (
    <main
      className="platform-page platform-page--ant"
      aria-label={title}
      data-description={description || undefined}
    >
      <Flex className="platform-page__heading" align="center" justify="space-between" gap={8} wrap="wrap">
        <div>
          {eyebrow ? <Text className="platform-page__eyebrow">{eyebrow}</Text> : null}
          <Title level={1}>{title}</Title>
          {description ? <Text type="secondary">{description}</Text> : null}
        </div>
        {actions ? <Flex align="center" gap={8} wrap="wrap">{actions}</Flex> : null}
      </Flex>
      <div className="platform-page__content">{children}</div>
    </main>
  );
}
