/**
 * ThemeProvider — wrapper-scoped theme manager for @emdash/ui.
 *
 * Renders a wrapper element, applies the active theme's selector class
 * (e.g. ".emlight" / ".emdark") onto that wrapper, and provides a
 * ThemeContext so descendants can read and change the theme.
 *
 * Designed for use in Storybook, isolated library consumers, and any
 * context where a wrapper element is acceptable. The Electron desktop app
 * has its own document.documentElement-based provider that stays in place.
 *
 * Usage:
 *   <ThemeProvider defaultTheme="light">
 *     <App />
 *   </ThemeProvider>
 *
 *   const { themeId, setTheme, toggle } = useTheme();
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { cn } from '../lib/cn';
import { THEME_MANIFEST } from '../../theme/core/theme-manifest';
import type { ThemeId } from '../../theme/core/theme-manifest';

// Re-export for consumers that want to enumerate themes.
export type { ThemeId };
export { THEME_MANIFEST };

interface ThemeContextValue {
  /** Active theme id (e.g. "light" | "dark"). */
  themeId: ThemeId;
  /** Change to a specific theme id. */
  setTheme: (id: ThemeId) => void;
  /** Toggle between the first two themes in the manifest (light ↔ dark). */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Returns the active theme context. Must be called inside a ThemeProvider.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside a ThemeProvider');
  }
  return ctx;
}

/**
 * Returns the CSS selector class for the active theme (e.g. `"emlight"` or
 * `"emdark"`), or an empty string when called outside a ThemeProvider.
 *
 * Designed for portal elements that need to inherit the theme when they render
 * outside the ThemeProvider's wrapper element. Apply the returned class to the
 * outermost element of the portal so theme-scoped CSS tokens resolve correctly.
 *
 * In the Electron desktop app the theme class is applied to
 * `document.documentElement`, so all portals already inherit it — the empty
 * string returned here has no effect.
 */
export function usePortalThemeClass(): string {
  const ctx = useContext(ThemeContext);
  if (!ctx) return '';
  const entry = THEME_MANIFEST.find((e) => e.id === ctx.themeId) ?? THEME_MANIFEST[0]!;
  return entry.selector.replace(/^\./, '');
}

export interface ThemeProviderProps {
  /**
   * Controlled theme id. When provided, the component is fully controlled —
   * the class always reflects this value and internal state is kept in sync.
   * Use this when an external owner (e.g. Storybook globals) drives the theme.
   */
  theme?: ThemeId;
  /**
   * Uncontrolled initial theme id. Only used on the first render.
   * Defaults to the first entry in the manifest ("light").
   */
  defaultTheme?: ThemeId;
  /** Element type for the wrapper. Defaults to 'div'. */
  as?: React.ElementType;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/**
 * ThemeProvider — renders a wrapper element and applies the active theme
 * selector class onto it, so all children resolve CSS tokens from the
 * correct polarity context.
 *
 * Supports both controlled (`theme` prop) and uncontrolled (`defaultTheme`)
 * usage, following the standard React pattern.
 */
export function ThemeProvider({
  theme: controlledTheme,
  defaultTheme,
  as: As = 'div',
  className,
  style,
  children,
}: ThemeProviderProps) {
  const initial: ThemeId =
    controlledTheme ?? defaultTheme ?? (THEME_MANIFEST[0]?.id as ThemeId) ?? 'light';
  const [themeId, setThemeId] = useState<ThemeId>(initial);

  // Sync internal state whenever the controlled prop changes.
  const prevControlled = React.useRef(controlledTheme);
  if (controlledTheme !== undefined && controlledTheme !== prevControlled.current) {
    prevControlled.current = controlledTheme;
    setThemeId(controlledTheme);
  }

  // The resolved id: controlled value wins; otherwise use internal state.
  const resolvedThemeId = controlledTheme ?? themeId;

  const setTheme = useCallback((id: ThemeId) => {
    setThemeId(id);
  }, []);

  const toggle = useCallback(() => {
    setThemeId((current) => {
      const ids = THEME_MANIFEST.map((e) => e.id as ThemeId);
      const idx = ids.indexOf(current);
      return ids[(idx + 1) % ids.length] ?? ids[0]!;
    });
  }, []);

  const entry = THEME_MANIFEST.find((e) => e.id === resolvedThemeId) ?? THEME_MANIFEST[0]!;
  // Strip the leading "." to get a plain class name.
  const themeClass = entry.selector.replace(/^\./, '');

  const ctx = useMemo<ThemeContextValue>(
    () => ({ themeId: resolvedThemeId, setTheme, toggle }),
    [resolvedThemeId, setTheme, toggle]
  );

  return (
    <ThemeContext.Provider value={ctx}>
      <As className={cn(themeClass, className)} style={style}>
        {children}
      </As>
    </ThemeContext.Provider>
  );
}
