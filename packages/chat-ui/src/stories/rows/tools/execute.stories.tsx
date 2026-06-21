/**
 * Execute row stories — shell command execution in each status.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ChatHost, ScriptedChat } from '../../_harness/chat-host';
import { ToolStateMatrix } from '../../_harness/state-matrix';
import { scenario, seedStep, streamExecute } from '../../_harness/streaming/scenario';

const meta: Meta = {
  title: 'Rows/Tools/Execute',
  component: ChatHost,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof ChatHost>;

export const StateMatrix: Story = {
  render: () => (
    <ToolStateMatrix
      build={(status) => ({
        kind: 'execute',
        id: `ex-matrix-${status}`,
        command: 'pnpm run build',
        status,
        startedAt: Date.now() - 3000,
        ...(status !== 'running' ? { durationMs: 3000 } : {}),
      })}
    />
  ),
};

export const Running: Story = {
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

/** Streaming simulation: execute starts running then transitions to done. */
export const RunningStreamed: Story = {
  render: () => (
    <ScriptedChat
      height={120}
      script={scenario(
        [seedStep([{ kind: 'message', id: 'u1', role: 'user', text: 'Run the build' }])],
        streamExecute({ id: 'ex-stream', command: 'pnpm run build', durationMs: 1200 })
      )}
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
