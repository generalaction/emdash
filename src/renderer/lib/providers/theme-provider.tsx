import { createContext, useEffect, useLayoutEffect, type ReactNode } from 'react';
import type { Theme } from '@shared/app-settings';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useLocalStorage } from '@renderer/lib/hooks/useLocalStorage';
import { applyThemeToAll } from '@renderer/lib/pty/pty';

type EffectiveTheme = 'emlight' | 'emdark';

function getSystemTheme(): EffectiveTheme {
  if (typeof window === 'undefined') return 'emlight';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'emdark' : 'emlight';
}

function applyTheme(effective: EffectiveTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('emlight', 'emdark');
  root.classList.add(effective);
}

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  effectiveTheme: EffectiveTheme;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { value: themeValue, isLoading, update } = useAppSettingsKey('theme');
  const [, setCachedTheme] = useLocalStorage<Theme>('emdash-theme', null);

  const theme: Theme = themeValue ?? null;
  const effectiveTheme: EffectiveTheme = theme ?? getSystemTheme();

  useLayoutEffect(() => {
    if (isLoading) return;
    applyTheme(effectiveTheme);
  }, [effectiveTheme, isLoading]);

  useEffect(() => {
    if (isLoading) return;
    setCachedTheme(theme);
  }, [theme, isLoading, setCachedTheme]);

  // Subscribe to system color scheme changes when no explicit preference is set.
  useEffect(() => {
    if (theme !== null) return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (isLoading) return;
      const newEffective = mq.matches ? 'emdark' : 'emlight';
      applyTheme(newEffective);
      applyThemeToAll();
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, isLoading]);

  // Re-apply xterm theme after CSS classes have been updated by the effect above.
  useEffect(() => {
    applyThemeToAll();
  }, [effectiveTheme]);

  const setTheme = (newTheme: Theme) => {
    update(newTheme);
  };

  const toggleTheme = () => {
    const next = effectiveTheme === 'emlight' ? 'emdark' : 'emlight';
    setTheme(next);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, effectiveTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
