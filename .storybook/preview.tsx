import type { Preview } from '@storybook/react-vite';
import React from 'react';
import '../src/renderer/index.css';

const preview: Preview = {
  decorators: [
    (Story) => (
      <div
        className="emdark bg-background"
        style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}
      >
        <Story />
      </div>
    ),
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: 'todo',
    },
  },
};

export default preview;
