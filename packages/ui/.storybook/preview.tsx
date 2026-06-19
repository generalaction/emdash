import type { Decorator, Preview } from '@storybook/react-vite';
import React from 'react';
import { ThemeProvider } from '../src/primitives/theme-provider';
import type { ThemeId } from '../src/primitives/theme-provider';
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

  const surfaceClass = surface !== 'none' ? `surface-${surface}` : '';
  const bgClass = surface !== 'none' ? 'bg-surface' : 'bg-background';

  return (
    <ThemeProvider theme={colorMode} className={`min-h-screen p-8 ${bgClass} ${surfaceClass}`}>
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
