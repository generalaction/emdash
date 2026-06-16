import type { Preview } from 'storybook-solidjs-vite';
import './preview.css';

const preview: Preview = {
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story, context) => {
      const theme = (context.globals as Record<string, string>)['theme'] ?? 'emlight';
      return (
        <div class={`${theme} min-h-screen bg-background p-8 text-foreground`}>
          <Story />
        </div>
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
  },
};

export default preview;
