import {
  createContext,
  useEffect,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useLocalStorage } from '@renderer/lib/hooks/useLocalStorage';
import { applyThemeToAll } from '@renderer/lib/pty/pty';
import { getNextTheme } from '@renderer/lib/theme/theme-toggle-model';
import type { Theme } from '@shared/core/app-settings';

export type EffectiveTheme = 'emlight' | 'emdark' | 'emwebstorm';

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
  root.classList.remove('emlight', 'emdark', 'emwebstorm');
  // WebStorm adds BOTH emdark and emwebstorm so that:
  //   (a) .emwebstorm{} CSS vars cascade on top of .emdark{} vars (same @layer, later wins), and
  //   (b) `emdark:` Tailwind variant utilities (emdark:invert, emdark:text-foreground, …) keep
  //       firing for descendants. Do not drop the emdark class here.
  if (effective === 'emwebstorm') {
    root.classList.add('emdark', 'emwebstorm');
  } else {
    root.classList.add(effective);
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
  const { value: themeValue, isLoading, update } = useAppSettingsKey('theme');
  const [, setCachedTheme] = useLocalStorage<Theme>('emdash-theme', null);

  const systemTheme = useSyncExternalStore(subscribeToSystemTheme, getSystemTheme);

  const theme: Theme = themeValue ?? null;
  const effectiveTheme: EffectiveTheme = theme ?? systemTheme;

  useLayoutEffect(() => {
    if (isLoading) return;
    applyTheme(effectiveTheme);
  }, [effectiveTheme, isLoading]);

  useEffect(() => {
    if (isLoading) return;
    setCachedTheme(theme);
  }, [theme, isLoading, setCachedTheme]);

  // Re-apply xterm theme after CSS classes have been updated by the layout effect above.
  useEffect(() => {
    applyThemeToAll();
  }, [effectiveTheme]);

  const setTheme = (newTheme: Theme) => {
    update(newTheme);
  };

  const toggleTheme = () => {
    const next = getNextTheme(theme, effectiveTheme);
    setTheme(next);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, effectiveTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
