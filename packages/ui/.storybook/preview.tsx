import type { Preview } from '@storybook/react';
import React from 'react';
import './preview.css';

const preview: Preview = {
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals['theme'] ?? 'emlight';
      return (
        <div className={`${theme} min-h-screen bg-background p-8 text-foreground`}>
          <Story />
        </div>
      );
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
