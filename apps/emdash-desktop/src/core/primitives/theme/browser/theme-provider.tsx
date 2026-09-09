import {
  resolveTheme,
  THEME_PREPAINT_CLASS_DATA,
  type Theme as ResolvedTheme,
  type ThemePrepaintClassEntry,
  type ThemeProfileIds,
} from '@emdash/theme/runtime';
import { ThemeProvider as ControlledThemeProvider } from '@emdash/ui/react/theme-runtime';
import { createContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { Theme } from '@core/primitives/app-settings/api';
import {
  normalizeThemeProfileSelection,
  resolveThemeProfileIds,
} from '@core/primitives/theme/api/theme-profile-selection';
import { THEME_STORAGE_KEY } from './theme-classes';
import { getNextTheme } from './theme-toggle-model';

export type EffectiveTheme = ResolvedTheme['classNames'][0];

function getSystemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Resolves the complete desktop Theme through the public profile manifests. */
export function resolveDesktopTheme(value: unknown, systemPrefersDark: boolean): ResolvedTheme {
  return resolveTheme(resolveThemeProfileIds(value, systemPrefersDark));
}

function subscribeToSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function activePrepaintProfileId<Id extends string>(
  entries: readonly ThemePrepaintClassEntry<Id>[]
): Id | null {
  const entry = entries.find(({ className }) =>
    document.documentElement.classList.contains(className)
  );
  return entry?.id ?? null;
}

function getPrepaintTheme(): ResolvedTheme | null {
  if (typeof document === 'undefined') return null;
  const profileIds = {
    colorScheme: activePrepaintProfileId(THEME_PREPAINT_CLASS_DATA.colorSchemes),
    density: activePrepaintProfileId(THEME_PREPAINT_CLASS_DATA.densities),
    typography: activePrepaintProfileId(THEME_PREPAINT_CLASS_DATA.typographies),
  };
  if (!profileIds.colorScheme || !profileIds.density || !profileIds.typography) return null;
  return resolveTheme(profileIds as ThemeProfileIds);
}

export interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  effectiveTheme: EffectiveTheme;
  resolvedTheme: ResolvedTheme;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export interface ThemeProviderProps {
  readonly children: ReactNode;
  readonly theme: Theme | null;
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
  const systemPrefersDark = useSyncExternalStore(
    subscribeToSystemTheme,
    getSystemPrefersDark,
    getSystemPrefersDark
  );
  const selectedTheme = useMemo(() => normalizeThemeProfileSelection(theme), [theme]);
  const resolvedTheme = useMemo(
    () =>
      (isLoading ? getPrepaintTheme() : null) ??
      resolveDesktopTheme(selectedTheme, systemPrefersDark),
    [isLoading, selectedTheme, systemPrefersDark]
  );
  const effectiveTheme = resolvedTheme.classNames[0];

  useEffect(() => {
    if (isLoading) return;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(selectedTheme));
    } catch {
      // Local storage is only a startup paint cache; persisted settings remain authoritative.
    }
  }, [selectedTheme, isLoading]);

  const setTheme = (newTheme: Theme) => {
    onThemeChange(newTheme);
  };

  const toggleTheme = () => {
    const next = getNextTheme(selectedTheme, effectiveTheme);
    setTheme(next);
  };

  useEffect(() => {
    if (!isLoading) onThemeApplied?.(effectiveTheme);
  }, [effectiveTheme, isLoading, onThemeApplied]);

  return (
    <ThemeContext.Provider
      value={{ theme: selectedTheme, setTheme, toggleTheme, effectiveTheme, resolvedTheme }}
    >
      <ControlledThemeProvider target="document" theme={resolvedTheme}>
        {children}
      </ControlledThemeProvider>
    </ThemeContext.Provider>
  );
}
