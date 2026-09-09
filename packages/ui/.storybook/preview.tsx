import { tokens, type SurfaceLevelName, type SurfaceRoleName } from '@emdash/theme';
import { DENSITY_MANIFEST, TYPOGRAPHY_MANIFEST, type ColorSchemeId } from '@emdash/theme/profiles';
import { resolveTheme } from '@emdash/theme/runtime';
import { ThemeProvider } from '@emdash/ui/react/theme-runtime';
import { surface as surfaceRecipe } from '@emdash/ui/styles/recipes/surface';
import type { Decorator, Preview } from '@storybook/react-vite';
import React from 'react';
import { storybookChatHostAdapterClassName } from './chat-host-adapter.css';
import './styles.css';

const SURFACE_LEVELS = Object.keys(tokens.surface.level) as SurfaceLevelName[];
const SURFACE_ROLES = Object.keys(tokens.surface.role) as SurfaceRoleName[];
const SURFACE_FAMILIES = ['none', ...SURFACE_LEVELS, ...SURFACE_ROLES] as const;
type SurfaceFamily = (typeof SURFACE_FAMILIES)[number];

const withTheme: Decorator = (Story, context) => {
  const colorMode = (context.globals['colorMode'] as ColorSchemeId) ?? 'light';
  const surface = (context.globals['surface'] as SurfaceFamily) ?? 'none';
  const density = DENSITY_MANIFEST[0];
  const typography = TYPOGRAPHY_MANIFEST[0];
  if (!density || !typography)
    throw new Error('Storybook requires Density and Typography profiles');
  const theme = resolveTheme({
    colorScheme: colorMode,
    density: density.id,
    typography: typography.id,
  });
  // Fullscreen stories own their layout — don't inject padding/min-height that
  // would stack on top of a story's own h-screen and overflow the viewport.
  const fullscreen = context.parameters?.['layout'] === 'fullscreen';

  const surfaceClass =
    surface === 'none'
      ? ''
      : surface === 'paper'
        ? surfaceRecipe({ role: surface })
        : surfaceRecipe({ level: surface });
  const frameClassName = [storybookChatHostAdapterClassName, surfaceClass]
    .filter(Boolean)
    .join(' ');
  // Set the design-system font on the frame (inline style) so story content wins
  // over Storybook's preview base body font; native controls pick it up via the
  // `font: inherit` reset in theme.base.css.
  const frameStyle: React.CSSProperties = fullscreen
    ? {
        height: '100vh',
        fontFamily: 'var(--em-font-sans)',
        backgroundColor: surface !== 'none' ? 'var(--em-surface)' : 'var(--em-background)',
      }
    : {
        minHeight: '100vh',
        padding: '2rem',
        fontFamily: 'var(--em-font-sans)',
        backgroundColor: surface !== 'none' ? 'var(--em-surface)' : 'var(--em-background)',
      };

  // The controlled runtime applies the complete profile class set to <html>;
  // stylesheet loading remains explicit above.
  return (
    <ThemeProvider theme={theme} target="document">
      <div className={frameClassName} style={frameStyle}>
        <Story />
      </div>
    </ThemeProvider>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    colorMode: {
      description: 'Color mode',
      toolbar: {
        title: 'Color mode',
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light', icon: 'sun' },
          { value: 'dark', title: 'Dark', icon: 'moon' },
          { value: 'solarized-light', title: 'Solarized Light', icon: 'sun' },
          { value: 'solarized-dark', title: 'Solarized Dark', icon: 'moon' },
        ],
        dynamicTitle: true,
      },
    },
    surface: {
      description: 'Surface backdrop',
      toolbar: {
        title: 'Surface',
        icon: 'component',
        items: SURFACE_FAMILIES.map((s) => ({ value: s, title: s === 'none' ? 'Default' : s })),
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    colorMode: 'light',
    surface: 'none',
  },
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /date/i } },
    docs: { codePanel: true },
  },
};

export default preview;
