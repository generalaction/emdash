import type { Decorator, Preview } from '@storybook/react-vite';
import React, { useEffect } from 'react';
import './theme.css';

const COLOR_MODES = ['emlight', 'emdark'] as const;
type ColorMode = (typeof COLOR_MODES)[number];

const SURFACE_FAMILIES = ['none', 'app', 'secondary', 'tertiary', 'quaternary'] as const;
type SurfaceFamily = (typeof SURFACE_FAMILIES)[number];

const withTheme: Decorator = (Story, context) => {
  const colorMode = (context.globals['colorMode'] as ColorMode) ?? 'emlight';
  const surface = (context.globals['surface'] as SurfaceFamily) ?? 'none';

  useEffect(() => {
    document.documentElement.classList.remove(...COLOR_MODES);
    document.documentElement.classList.add(colorMode);
  }, [colorMode]);

  const surfaceClass = surface !== 'none' ? `surface-${surface}` : '';
  const bgClass = surface !== 'none' ? `bg-surface` : 'bg-background';

  return (
    <div className={`min-h-screen p-8 ${bgClass} ${surfaceClass}`}>
      <Story />
    </div>
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
          { value: 'emlight', title: 'Light', icon: 'sun' },
          { value: 'emdark', title: 'Dark', icon: 'moon' },
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
    colorMode: 'emlight',
    surface: 'none',
  },
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /date/i } },
  },
};

export default preview;
