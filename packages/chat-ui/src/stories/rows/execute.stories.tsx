/**
 * Execute row stories — shell command execution in each status.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ChatHost } from '../chat-host';

const meta: Meta = {
  title: 'Rows/Execute',
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
          kind: 'execute',
          id: 'ex1',
          command: 'ls -a',
          status: 'running',
          startedAt: Date.now() - 3000,
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
          kind: 'execute',
          id: 'ex2',
          command: 'ls -a',
          status: 'done',
          startedAt: Date.now() - 5000,
          durationMs: 5000,
        },
      ]}
      height={80}
    />
  ),
};

/** Duration omitted — e.g. when replaying from a stored transcript with no durationMs. */
export const DoneNoDuration: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'execute',
          id: 'ex3',
          command: 'ls -a',
          status: 'done',
          startedAt: 0,
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
          kind: 'execute',
          id: 'ex4',
          command: 'pnpm run test',
          status: 'error',
          startedAt: Date.now() - 8000,
          durationMs: 8000,
        },
      ]}
      height={80}
    />
  ),
};

/** Long command — demos 150px truncation with full value on hover. */
export const LongCommand: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'execute',
          id: 'ex5',
          command: 'find . -type f -name "*.ts" | xargs grep -l "import.*from.*solid-js"',
          status: 'done',
          startedAt: Date.now() - 2000,
          durationMs: 2000,
        },
      ]}
      height={80}
    />
  ),
};
