/**
 * Diff row stories — file diff preview in each scenario.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ChatHost } from '../chat-host';

const meta: Meta = {
  title: 'Rows/Diff',
  component: ChatHost,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof ChatHost>;

const OLD_TS = `export type ChatToolCall = {
  kind: 'tool';
  id: string;
  name: string;
  status: ToolStatus;
};`;

const NEW_TS = `export type ChatToolCall = {
  kind: 'tool';
  id: string;
  name: string;
  status: ToolStatus;
  inputSummary?: string;
};`;

/** Typical edit: adds a field, removes nothing. */
export const Default: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'diff',
          id: 'tc1:src/model.ts',
          path: 'src/model.ts',
          oldText: OLD_TS,
          newText: NEW_TS,
          status: 'done',
        },
      ]}
      height={200}
    />
  ),
};

/** New file — all lines are additions, no deletions. */
export const NewFile: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'diff',
          id: 'tc2:src/components/diff/metrics.ts',
          path: 'src/components/diff/metrics.ts',
          oldText: null,
          newText: `export const DIFF_HEADER_H = 28;
export const DIFF_PAD_Y = 6;
export const DIFF_MAX_LINES = 12;
export const DIFF_CONTEXT = 1;`,
          status: 'done',
        },
      ]}
      height={140}
    />
  ),
};

/** Deep change — first change is far into the file; window anchors there. */
export const DeepFirstChange: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'diff',
          id: 'tc3:src/index.ts',
          path: 'src/index.ts',
          oldText: 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nold_value\nline9\nline10\n',
          newText: 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nnew_value\nline9\nline10\n',
          status: 'done',
        },
      ]}
      height={160}
    />
  ),
};

/** Multiple diff rows — one per changed file (as produced by a multi-file edit). */
export const MultiFile: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'diff',
          id: 'tc4:packages/chat-ui/src/model.ts',
          path: 'packages/chat-ui/src/model.ts',
          oldText: OLD_TS,
          newText: NEW_TS,
          status: 'done',
        },
        {
          kind: 'diff',
          id: 'tc4:packages/chat-ui/src/index.tsx',
          path: 'packages/chat-ui/src/index.tsx',
          oldText: `export type { ChatExecute } from './model';`,
          newText: `export type { ChatDiff, ChatExecute } from './model';`,
          status: 'done',
        },
      ]}
      height={300}
    />
  ),
};

/** Running diff — status still in progress. */
export const Generating: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'diff',
          id: 'tc5:src/app.ts',
          path: 'src/app.ts',
          oldText: `const version = '1.0.0';`,
          newText: `const version = '2.0.0';`,
          status: 'running',
        },
      ]}
      height={120}
    />
  ),
};
