import type { Decorator, Preview } from '@storybook/react-vite';
import React, { useEffect } from 'react';
import { ThemeProvider } from '../src/primitives/theme-provider';
import type { ThemeId } from '../src/primitives/theme-provider';
import { THEME_MANIFEST } from '../src/theme/theme-manifest';
import './theme.css';

const COLOR_MODES: ThemeId[] = ['light', 'dark'];

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
  const bgClass = surface !== 'none' ? 'bg-surface' : 'bg-background';
  const frame = fullscreen ? 'h-screen' : 'min-h-screen p-8';

  // Sync the theme class to document.body so portal-rendered elements
  // (ComboboxPopup, dropdowns, popovers, etc.) inherit the correct tokens.
  useEffect(() => {
    const entry = THEME_MANIFEST.find((e) => e.id === colorMode) ?? THEME_MANIFEST[0]!;
    const cls = entry.selector.replace(/^\./, '');
    const allClasses = THEME_MANIFEST.map((e) => e.selector.replace(/^\./, ''));
    document.body.classList.remove(...allClasses);
    document.body.classList.add(cls);
    return () => {
      document.body.classList.remove(...allClasses);
    };
  }, [colorMode]);

  return (
    <ThemeProvider theme={colorMode} className={`${frame} ${bgClass} ${surfaceClass}`}>
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
