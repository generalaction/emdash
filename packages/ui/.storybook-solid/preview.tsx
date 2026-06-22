import type { Decorator, Preview } from 'storybook-solidjs';
import { createEffect } from 'solid-js';
import { THEME_MANIFEST } from '../src/theme/core/theme-manifest';
// Side-effect: pulls VE surfaces + tokens into the build graph.
import '../src/styles/sprinkles.css';
import './theme.css';

type ThemeId = (typeof THEME_MANIFEST)[number]['id'];

const COLOR_MODES: ThemeId[] = ['light', 'dark', 'solarized-light', 'solarized-dark'];

const withTheme: Decorator = (Story, context) => {
  const colorMode = (context.globals['colorMode'] as ThemeId) ?? 'light';

  // Apply theme class to <html> so all CSS custom properties resolve correctly,
  // matching how the desktop app and React Storybook apply themes.
  createEffect(() => {
    const entry = THEME_MANIFEST.find((e) => e.id === colorMode) ?? THEME_MANIFEST[0]!;
    const cls = entry.selector.replace(/^\./, '');
    const allClasses = THEME_MANIFEST.map((e) => e.selector.replace(/^\./, ''));
    const root = document.documentElement;
    root.classList.remove(...allClasses);
    root.classList.add(cls);
  });

  return (
    <div
      style={{
        'min-height': '100vh',
        padding: '2rem',
        'font-family': 'var(--font-sans)',
        'background-color': 'var(--background)',
        color: 'var(--foreground)',
      }}
    >
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
          { value: 'light', title: 'Light', icon: 'sun' },
          { value: 'dark', title: 'Dark', icon: 'moon' },
          { value: 'solarized-light', title: 'Solarized Light', icon: 'sun' },
          { value: 'solarized-dark', title: 'Solarized Dark', icon: 'moon' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    colorMode: 'light',
  },
  parameters: {
    controls: { matchers: { color: /(background|color)$/i } },
  },
};

export default preview;
