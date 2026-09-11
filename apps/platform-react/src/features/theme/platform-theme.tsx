import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * 用户可见主题只有浅色和深色；`glass` 是浅色主题的兼容内部值，
 * 这样既能保留已有本地设置，又不再暴露独立的玻璃主题选项。
 */
export type PlatformThemeMode = 'system' | 'dark' | 'glass';
export type ResolvedThemeMode = Exclude<PlatformThemeMode, 'system'>;

interface PlatformThemeContextValue {
  mode: PlatformThemeMode;
  resolvedMode: ResolvedThemeMode;
  setMode: (mode: PlatformThemeMode) => void;
}

const THEME_MODE_KEY = 'product-experience-center:theme-mode';
const PlatformThemeContext = createContext<PlatformThemeContextValue | null>(null);

function readThemeMode(): PlatformThemeMode {
  try {
    const stored = localStorage.getItem(THEME_MODE_KEY);
    if (stored === 'system' || stored === 'dark' || stored === 'glass') return stored;
    // 旧版默认浅色与新版浅色统一，避免升级后继续读取旧的蓝色浅色主题。
    if (stored === 'default') return 'glass';
    return 'glass';
  } catch {
    return 'glass';
  }
}

function prefersDarkTheme() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export function resolveThemeMode(mode: PlatformThemeMode, prefersDark: boolean): ResolvedThemeMode {
  return mode === 'system' ? (prefersDark ? 'dark' : 'glass') : mode;
}

export function PlatformThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<PlatformThemeMode>(readThemeMode);
  const [prefersDark, setPrefersDark] = useState(prefersDarkTheme);
  const resolvedMode = resolveThemeMode(mode, prefersDark);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const update = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedMode;
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.style.colorScheme = resolvedMode === 'dark' ? 'dark' : 'light';
    delete document.documentElement.dataset.density;
  }, [mode, resolvedMode]);

  const value = useMemo<PlatformThemeContextValue>(
    () => ({
      mode,
      resolvedMode,
      setMode(nextMode) {
        setModeState(nextMode);
        try {
          localStorage.setItem(THEME_MODE_KEY, nextMode);
        } catch {
          // Storage is optional; the active session still updates.
        }
      },
    }),
    [mode, resolvedMode],
  );

  return <PlatformThemeContext.Provider value={value}>{children}</PlatformThemeContext.Provider>;
}

export function usePlatformTheme() {
  const context = useContext(PlatformThemeContext);
  if (!context) throw new Error('usePlatformTheme must be used inside PlatformThemeProvider.');
  return context;
}
