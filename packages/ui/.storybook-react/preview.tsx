import type { Decorator, Preview } from '@storybook/react-vite';
import React, { useEffect } from 'react';
import { ThemeProvider } from '../src/react/primitives/theme-provider';
import type { ThemeId } from '../src/react/primitives/theme-provider';
import { THEME_MANIFEST } from '../src/theme/themes/registry';
// Side-effect: pulls surfaces.css.ts + tokens.css.ts into the VE build graph.
import '../src/styles/sprinkles.css';
import './theme.css';
// Third-party CSS loaded globally so all stories can rely on them without
// individual imports. Vite handles these in the Storybook build.
import 'devicon/devicon.min.css';
import '@emdash/chat-ui/style.css';
import '@emdash/chat-ui/chat-theme.css';

const COLOR_MODES: ThemeId[] = ['light', 'dark', 'solarized-light', 'solarized-dark'];

const SURFACE_FAMILIES = [
  'none',
  'sunken',
  'base',
  'base-emphasis',
  'elevated',
  'elevated-emphasis',
] as const;
type SurfaceFamily = (typeof SURFACE_FAMILIES)[number];

const withTheme: Decorator = (Story, context) => {
  const colorMode = (context.globals['colorMode'] as ThemeId) ?? 'light';
  const surface = (context.globals['surface'] as SurfaceFamily) ?? 'none';
  // Fullscreen stories own their layout — don't inject padding/min-height that
  // would stack on top of a story's own h-screen and overflow the viewport.
  const fullscreen = context.parameters?.['layout'] === 'fullscreen';

  const surfaceClass = surface !== 'none' ? `surface-${surface}` : '';
  // Set the design-system font on the frame (inline style) so story content wins
  // over Storybook's preview base body font; native controls pick it up via the
  // `font: inherit` reset in theme.base.css.
  const frameStyle: React.CSSProperties = fullscreen
    ? {
        height: '100vh',
        fontFamily: 'var(--font-sans)',
        backgroundColor: surface !== 'none' ? 'var(--surface)' : 'var(--background)',
      }
    : {
        minHeight: '100vh',
        padding: '2rem',
        fontFamily: 'var(--font-sans)',
        backgroundColor: surface !== 'none' ? 'var(--surface)' : 'var(--background)',
      };

  // Sync the theme class to <html> (document.documentElement) so every token —
  // including :root-scoped rules like the surface default binding and the global
  // font — resolves from the top of the tree, and portal-rendered elements
  // (ComboboxPopup, dropdowns, popovers, etc.) inherit the correct tokens. This
  // matches how the desktop app applies the theme.
  useEffect(() => {
    const entry = THEME_MANIFEST.find((e) => e.id === colorMode) ?? THEME_MANIFEST[0]!;
    const cls = entry.selector.replace(/^\./, '');
    const allClasses = THEME_MANIFEST.map((e) => e.selector.replace(/^\./, ''));
    const root = document.documentElement;
    root.classList.remove(...allClasses);
    root.classList.add(cls);
    return () => {
      root.classList.remove(...allClasses);
    };
  }, [colorMode]);

  return (
    <ThemeProvider theme={colorMode} className={surfaceClass} style={frameStyle}>
      <Story />
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
  },
};

export default preview;
