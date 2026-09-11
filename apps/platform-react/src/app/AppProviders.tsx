import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { App as AntApp, ConfigProvider, zhCN } from '@/ui/ant';
import { createAntThemeConfig } from '@/features/theme/ant-theme-config';
import { PlatformThemeProvider, usePlatformTheme } from '@/features/theme/platform-theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 20_000,
      retry: 1,
    },
  },
});

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <PlatformThemeProvider>
        <AntDesignProvider>{children}</AntDesignProvider>
      </PlatformThemeProvider>
    </QueryClientProvider>
  );
}

function AntDesignProvider({ children }: { children: ReactNode }) {
  const { resolvedMode } = usePlatformTheme();

  return (
    <ConfigProvider locale={zhCN} theme={createAntThemeConfig(resolvedMode)}>
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  );
}
