import {
  DENSITY_MANIFEST,
  TYPOGRAPHY_MANIFEST,
  type ColorSchemeId,
  type DensityId,
  type TypographyId,
} from '@emdash/theme/profiles';
import { resolveTheme } from '@emdash/theme/runtime';
import type { CSSProperties, ElementType, ReactNode } from 'react';
import { ThemeProvider } from './theme-runtime';

type StoryThemeScopeProps = {
  colorScheme: ColorSchemeId;
  density?: DensityId;
  typography?: TypographyId;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
};

/** Story-only wrapper for a controlled Theme scoped below the preview host. */
export function StoryThemeScope({
  colorScheme,
  density = DENSITY_MANIFEST[0]!.id,
  typography = TYPOGRAPHY_MANIFEST[0]!.id,
  as,
  className,
  style,
  children,
}: StoryThemeScopeProps) {
  return (
    <ThemeProvider
      theme={resolveTheme({ colorScheme, density, typography })}
      target="subtree"
      as={as}
      className={className}
      style={style}
    >
      {children}
    </ThemeProvider>
  );
}
