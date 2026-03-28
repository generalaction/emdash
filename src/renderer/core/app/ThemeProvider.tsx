import { createContext, useEffect, useState, type ReactNode } from 'react';
import { useAppSettings } from '@renderer/core/app/AppSettingsProvider';
import { applyThemeToAll } from '@renderer/core/pty/pty';
import { useLocalStorage } from '@renderer/hooks/useLocalStorage';

type Theme = 'light' | 'dark' | 'dark-black' | 'system' | 'emlight' | 'emdark';
type EffectiveTheme = 'light' | 'dark' | 'dark-black' | 'emlight' | 'emdark';

function getSystemTheme(): EffectiveTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark-black' : 'light';
}

function applyTheme(theme: Theme, systemTheme: EffectiveTheme) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const effectiveTheme = theme === 'system' ? systemTheme : theme;

  root.classList.remove('dark', 'dark-black', 'emlight', 'emdark');

  if (effectiveTheme === 'dark') {
    root.classList.add('dark');
  } else if (effectiveTheme === 'dark-black') {
    root.classList.add('dark', 'dark-black');
  } else if (effectiveTheme === 'emlight') {
    root.classList.add('emlight');
  }
}

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  effectiveTheme: EffectiveTheme;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings, updateSettings } = useAppSettings();
  const [systemTheme, setSystemTheme] = useState<EffectiveTheme>(() => getSystemTheme());
  const [, setCachedTheme] = useLocalStorage<Theme>('emdash-theme', 'system');

  const theme: Theme = settings?.theme ?? 'system';
  const effectiveTheme: EffectiveTheme = theme === 'system' ? systemTheme : theme;

  useEffect(() => {
    applyTheme(theme, systemTheme);
    setCachedTheme(theme);
  }, [theme, systemTheme, setCachedTheme]);

  // Re-apply xterm theme after CSS classes have been updated by the effect above.
  useEffect(() => {
    applyThemeToAll();
  }, [effectiveTheme]);

  // Listen for OS theme changes when preference is 'system'
  useEffect(() => {
    if (theme !== 'system') return undefined;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setSystemTheme(getSystemTheme());

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    updateSettings({ key: 'theme', value: newTheme });
  };

  const toggleTheme = () => {
    const base = theme === 'system' ? effectiveTheme : theme;
    const next: Theme = base === 'light' ? 'dark' : base === 'dark' ? 'dark-black' : 'light';
    setTheme(next);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, effectiveTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
