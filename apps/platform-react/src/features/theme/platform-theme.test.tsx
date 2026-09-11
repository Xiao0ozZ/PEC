import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PlatformThemeProvider, usePlatformTheme } from './platform-theme';

const STORAGE_KEY = 'product-experience-center:theme-mode';

function ThemeProbe() {
  const { mode, setMode } = usePlatformTheme();
  return <button onClick={() => setMode('dark')}>{mode}</button>;
}

describe('platform theme', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('restores and persists the selected Ant theme', async () => {
    // 旧版本的默认浅色设置应迁移到现在的浅色材质。
    localStorage.setItem(STORAGE_KEY, 'default');
    render(
      <PlatformThemeProvider>
        <ThemeProbe />
      </PlatformThemeProvider>,
    );

    expect(screen.getByRole('button', { name: 'glass' })).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('glass'));

    fireEvent.click(screen.getByRole('button', { name: 'glass' }));
    expect(screen.getByRole('button', { name: 'dark' })).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(document.documentElement.dataset.density).toBeUndefined();
  });
});
