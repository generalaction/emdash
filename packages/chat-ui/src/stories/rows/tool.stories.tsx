/**
 * Tool row stories — generic tool call in each status.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ChatHost } from '../chat-host';

const meta: Meta = {
  title: 'Rows/Tool',
  component: ChatHost,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof ChatHost>;

export const Generating: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'tool',
          id: 't1',
          name: 'search',
          status: 'running',
          inputSummary: 'SolidJS virtualized list patterns',
        },
      ]}
      height={80}
    />
  ),
};

export const Done: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'tool',
          id: 't2',
          name: 'fetch_url',
          status: 'done',
          inputSummary: 'https://solidjs.com/docs/latest',
        },
      ]}
      height={80}
    />
  ),
};

export const Error: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'tool',
          id: 't3',
          name: 'web.run',
          status: 'error',
          inputSummary: 'latest ACP protocol specification',
        },
      ]}
      height={80}
    />
  ),
};
