import { useAppSettings } from '@/contexts/AppSettingsProvider';
import { createContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'dark-black' | 'green' | 'system';
type EffectiveTheme = 'light' | 'dark' | 'dark-black' | 'green';

function getSystemTheme(): EffectiveTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark-black' : 'light';
}

function applyTheme(theme: Theme, systemTheme: EffectiveTheme) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const effectiveTheme = theme === 'system' ? systemTheme : theme;

  root.classList.remove('dark', 'dark-black', 'green');

  if (effectiveTheme === 'dark') {
    root.classList.add('dark');
  } else if (effectiveTheme === 'dark-black') {
    root.classList.add('dark', 'dark-black');
  } else if (effectiveTheme === 'green') {
    root.classList.add('dark', 'green');
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

  const theme: Theme = settings?.interface?.theme ?? 'system';
  const effectiveTheme: EffectiveTheme = theme === 'system' ? systemTheme : theme;

  useEffect(() => {
    applyTheme(theme, systemTheme);
  }, [theme, systemTheme]);

  // Always keep systemTheme in sync with OS so switching to 'system' is instant
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setSystemTheme(getSystemTheme());

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  const setTheme = (newTheme: Theme) => {
    updateSettings({ interface: { theme: newTheme } });
  };

  const toggleTheme = () => {
    const base = theme === 'system' ? effectiveTheme : theme;
    const next: Theme =
      base === 'light'
        ? 'dark'
        : base === 'dark'
          ? 'dark-black'
          : base === 'dark-black'
            ? 'green'
            : 'light';
    setTheme(next);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, effectiveTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
