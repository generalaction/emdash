import {
  COLOR_SCHEME_MANIFEST,
  DENSITY_MANIFEST,
  TYPOGRAPHY_MANIFEST,
  type ColorSchemeId,
} from '@emdash/theme/profiles';
import { resolveTheme, type Theme as ResolvedTheme } from '@emdash/theme/runtime';
import { ThemeProvider as ControlledThemeProvider } from '@emdash/ui/react/theme-runtime';
import { createContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { Theme } from '@core/primitives/app-settings/api';
import {
  THEME_CLASS_DARK,
  THEME_CLASS_LIGHT,
  THEME_CLASSES,
  THEME_STORAGE_KEY,
} from './theme-classes';
import { getNextTheme } from './theme-toggle-model';

export type EffectiveTheme = (typeof THEME_CLASSES)[number];

function getSystemTheme(): EffectiveTheme {
  if (typeof window === 'undefined') return THEME_CLASS_LIGHT;
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? THEME_CLASS_DARK
    : THEME_CLASS_LIGHT;
}

function colorSchemeId(effectiveTheme: EffectiveTheme): ColorSchemeId {
  const entry = COLOR_SCHEME_MANIFEST.find(
    (colorScheme) => colorScheme.selector === `.${effectiveTheme}`
  );
  if (!entry) {
    throw new Error(`No Color scheme profile for selector ".${effectiveTheme}"`);
  }
  return entry.id;
}

/** Resolves the complete desktop Theme through the public profile manifests. */
export function resolveDesktopTheme(effectiveTheme: EffectiveTheme): ResolvedTheme {
  const density = DENSITY_MANIFEST[0];
  const typography = TYPOGRAPHY_MANIFEST[0];
  if (!density || !typography) {
    throw new Error('Desktop Theme requires at least one Density and Typography profile');
  }
  return resolveTheme({
    colorScheme: colorSchemeId(effectiveTheme),
    density: density.id,
    typography: typography.id,
  });
}

function subscribeToSystemTheme(onChange: () => void) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function getPrepaintTheme(): EffectiveTheme | null {
  if (typeof document === 'undefined') return null;
  return (
    THEME_CLASSES.find((className) => document.documentElement.classList.contains(className)) ??
    null
  );
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
  const effectiveTheme: EffectiveTheme =
    (isLoading ? getPrepaintTheme() : null) ?? theme ?? systemTheme;
  const resolvedTheme = useMemo(() => resolveDesktopTheme(effectiveTheme), [effectiveTheme]);

  useEffect(() => {
    if (isLoading) return;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
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
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, effectiveTheme, resolvedTheme }}>
      <ControlledThemeProvider target="document" theme={resolvedTheme}>
        {children}
      </ControlledThemeProvider>
    </ThemeContext.Provider>
  );
}
