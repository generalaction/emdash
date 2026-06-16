import type { Preview } from 'storybook-solidjs-vite';
import { DebugContext } from '../src/components/debug-context';
import './preview.css';

const preview: Preview = {
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story, context) => {
      const theme = (context.globals as Record<string, string>)['theme'] ?? 'emlight';
      const debugOn = (context.globals as Record<string, string>)['debug'] === 'on';
      return (
        <DebugContext.Provider value={() => debugOn}>
          <div class={`${theme} min-h-screen bg-background p-8 text-foreground`}>
            <Story />
          </div>
        </DebugContext.Provider>
      ) as unknown as ReturnType<typeof Story>;
    },
  ],
  globalTypes: {
    theme: {
      description: 'Color theme',
      defaultValue: 'emlight',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'emlight', title: 'Light' },
          { value: 'emdark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
    debug: {
      description: 'Layout boundary debug overlay',
      defaultValue: 'off',
      toolbar: {
        title: 'Debug',
        icon: 'ruler',
        items: [
          { value: 'off', title: 'Debug off' },
          { value: 'on', title: 'Debug on' },
        ],
        dynamicTitle: true,
      },
    },
  },
};

export default preview;
