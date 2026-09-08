/**
 * CSS-free controlled Theme runtime.
 *
 * This module intentionally imports no stylesheet. Hosts remain responsible
 * for loading the matching `@emdash/theme` CSS artifact and pass a fully
 * resolved Theme to the provider.
 */
import { THEME_PREPAINT_CLASS_DATA, type Theme, type ThemeClassNames } from '@emdash/theme/runtime';
import {
  createContext,
  useContext,
  useLayoutEffect,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react';

export type ThemeApplicationTarget = {
  readonly classList: Pick<DOMTokenList, 'add' | 'remove'>;
};

const ALL_THEME_PROFILE_CLASSES = [
  ...THEME_PREPAINT_CLASS_DATA.colorSchemes,
  ...THEME_PREPAINT_CLASS_DATA.densities,
  ...THEME_PREPAINT_CLASS_DATA.typographies,
].map(({ className }) => className);

/** Applies one complete Theme while preserving unrelated host classes. */
export function applyTheme(target: ThemeApplicationTarget, theme: Theme): void {
  target.classList.remove(...ALL_THEME_PROFILE_CLASSES);
  target.classList.add(...theme.classNames);
}

/** Removes every class owned by the controlled Theme runtime. */
export function clearTheme(target: ThemeApplicationTarget): void {
  target.classList.remove(...ALL_THEME_PROFILE_CLASSES);
}

export const ThemeContext = createContext<Theme | null>(null);

/** Returns the complete resolved Theme for the current rendered scope. */
export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('useTheme must be used inside the controlled ThemeProvider');
  }
  return theme;
}

export function useThemeOptional(): Theme | null {
  return useContext(ThemeContext);
}

export type ThemeProviderProps = {
  /** The complete controlled Theme. This provider owns no profile state. */
  readonly theme: Theme;
  /** Apply to `<html>` or contain all profile classes on one subtree root. */
  readonly target?: 'document' | 'subtree';
  /** Element rendered for a subtree scope. */
  readonly as?: ElementType;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly children?: ReactNode;
};

function scopedClassName(className: string | undefined, themeClasses: ThemeClassNames): string {
  return [className, ...themeClasses].filter(Boolean).join(' ');
}

/**
 * Applies a caller-controlled full Theme to the document or a contained
 * subtree and provides that resolved Theme through React context.
 *
 * The host owns preference persistence and system-policy resolution. This
 * component only reconciles the supplied Theme classes and never loads CSS.
 *
 * @example
 * ```tsx
 * import { resolveTheme } from '@emdash/theme/runtime';
 * import { ThemeProvider } from '@emdash/ui/react/theme-runtime';
 *
 * const theme = resolveTheme({
 *   colorScheme: 'dark',
 *   density: 'comfortable',
 *   typography: 'default',
 * });
 *
 * <ThemeProvider theme={theme} target="document">
 *   <App />
 * </ThemeProvider>;
 * ```
 */
export function ThemeProvider({
  theme,
  target = 'document',
  as: As = 'div',
  className,
  style,
  children,
}: ThemeProviderProps) {
  useLayoutEffect(() => {
    if (target !== 'document' || typeof document === 'undefined') return;
    const root = document.documentElement;
    applyTheme(root, theme);
    return () => clearTheme(root);
  }, [target, theme]);

  if (target === 'subtree') {
    return (
      <ThemeContext.Provider value={theme}>
        <As className={scopedClassName(className, theme.classNames)} style={style}>
          {children}
        </As>
      </ThemeContext.Provider>
    );
  }

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
