import {
  createContext,
  useEffect,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { Theme } from '@core/primitives/app-settings/api';
import { getNextTheme } from './theme-toggle-model';

export type EffectiveTheme = 'emlight' | 'emdark';

function getSystemTheme(): EffectiveTheme {
  if (typeof window === 'undefined') return 'emlight';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'emdark' : 'emlight';
}

function subscribeToSystemTheme(onChange: () => void) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function applyTheme(effective: EffectiveTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('emlight', 'emdark');
  root.classList.add(effective);
}

export interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  effectiveTheme: EffectiveTheme;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export interface ThemeProviderProps {
  readonly children: ReactNode;
  readonly theme: Theme;
  readonly isLoading?: boolean;
  readonly onThemeChange: (theme: Theme) => void;
  readonly onThemeApplied?: (effectiveTheme: EffectiveTheme) => void;
}

export function ThemeProvider({
  children,
  theme,
  isLoading = false,
  onThemeChange,
  onThemeApplied,
}: ThemeProviderProps) {
  const systemTheme = useSyncExternalStore(subscribeToSystemTheme, getSystemTheme);
  const effectiveTheme: EffectiveTheme = theme ?? systemTheme;

  useLayoutEffect(() => {
    if (isLoading) return;
    applyTheme(effectiveTheme);
  }, [effectiveTheme, isLoading]);

  useEffect(() => {
    if (isLoading) return;
    try {
      localStorage.setItem('emdash-theme', JSON.stringify(theme));
    } catch {
      // Local storage is only a startup paint cache; persisted settings remain authoritative.
    }
  }, [theme, isLoading]);

  const setTheme = (newTheme: Theme) => {
    onThemeChange(newTheme);
  };

  const toggleTheme = () => {
    const next = getNextTheme(theme, effectiveTheme);
    setTheme(next);
  };

  useEffect(() => {
    if (!isLoading) onThemeApplied?.(effectiveTheme);
  }, [effectiveTheme, isLoading, onThemeApplied]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, effectiveTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
