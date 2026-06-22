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

type EffectiveTheme = 'emlight' | 'emdark';

function getSystemTheme(): EffectiveTheme {
  if (typeof window === 'undefined') return 'emlight';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'emdark' : 'emlight';
}

function subscribeToSystemTheme(onChange: () => void) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function getSystemPrefersContrast(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-contrast: more)').matches;
}

function subscribeToSystemContrast(onChange: () => void) {
  const mq = window.matchMedia('(prefers-contrast: more)');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function applyTheme(effective: EffectiveTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('emlight', 'emdark');
  root.classList.add(effective);
}

function applyHighContrast(enabled: boolean) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('high-contrast', enabled);
}

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  effectiveTheme: EffectiveTheme;
  /** Resolved high-contrast state (explicit preference, or the OS setting when unset). */
  highContrast: boolean;
  setHighContrast: (enabled: boolean) => void;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { value: themeValue, isLoading, update } = useAppSettingsKey('theme');
  const {
    value: interfaceValue,
    isLoading: isInterfaceLoading,
    update: updateInterface,
  } = useAppSettingsKey('interface');
  const [, setCachedTheme] = useLocalStorage<Theme>('emdash-theme', null);
  const [, setCachedHighContrast] = useLocalStorage<boolean | null>('emdash-high-contrast', null);

  const systemTheme = useSyncExternalStore(subscribeToSystemTheme, getSystemTheme);
  const systemPrefersContrast = useSyncExternalStore(
    subscribeToSystemContrast,
    getSystemPrefersContrast
  );

  const theme: Theme = themeValue ?? null;
  const effectiveTheme: EffectiveTheme = theme ?? systemTheme;
  const highContrastPreference = interfaceValue?.highContrast ?? null;
  const highContrast = highContrastPreference ?? systemPrefersContrast;

  useLayoutEffect(() => {
    if (isLoading) return;
    applyTheme(effectiveTheme);
  }, [effectiveTheme, isLoading]);

  useLayoutEffect(() => {
    if (isInterfaceLoading) return;
    applyHighContrast(highContrast);
  }, [highContrast, isInterfaceLoading]);

  useEffect(() => {
    if (isLoading) return;
    setCachedTheme(theme);
  }, [theme, isLoading, setCachedTheme]);

  useEffect(() => {
    if (isInterfaceLoading) return;
    setCachedHighContrast(highContrastPreference);
  }, [highContrastPreference, isInterfaceLoading, setCachedHighContrast]);

  // Re-apply xterm theme after CSS classes have been updated by the layout effects
  // above. High contrast remaps tokens that feed --xterm-* (e.g. --foreground), so
  // open terminals must be re-themed when it toggles, not only on theme changes.
  useEffect(() => {
    applyThemeToAll();
  }, [effectiveTheme, highContrast]);

  const setTheme = (newTheme: Theme) => {
    update(newTheme);
  };

  const toggleTheme = () => {
    const next = getNextTheme(theme, effectiveTheme);
    setTheme(next);
  };

  const setHighContrast = (enabled: boolean) => {
    // Collapse to "follow system" (null) when the choice already matches the OS
    // preference, so the override / reset-to-default affordance only appears on a
    // genuine divergence from the system setting.
    updateInterface({ highContrast: enabled === systemPrefersContrast ? null : enabled });
  };

  return (
    <ThemeContext.Provider
      value={{ theme, setTheme, toggleTheme, effectiveTheme, highContrast, setHighContrast }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
