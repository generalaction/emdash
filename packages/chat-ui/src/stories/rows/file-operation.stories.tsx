/**
 * FileOperation row stories — file read/edit/delete/move in each scenario.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ChatHost, ChatHostExpanded, ScriptedChat } from '../chat-host';
import { scenario, seedStep, streamFileOp } from '../streaming/scenario';

const meta: Meta = {
  title: 'Rows/FileOperation',
  component: ChatHost,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof ChatHost>;

export const ReadSingle: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'file-op',
          id: 'fo1',
          op: 'read',
          status: 'done',
          ops: [{ path: 'packages/chat-ui/src/model.ts' }],
        },
      ]}
      height={80}
    />
  ),
};

export const EditSingle: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'file-op',
          id: 'fo2',
          op: 'edit',
          status: 'done',
          ops: [{ path: 'packages/chat-ui/src/components/tool/Tool.tsx' }],
        },
      ]}
      height={80}
    />
  ),
};

export const DeleteSingle: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'file-op',
          id: 'fo3',
          op: 'delete',
          status: 'done',
          ops: [{ path: 'packages/chat-ui/src/old-spec.ts' }],
        },
      ]}
      height={80}
    />
  ),
};

export const MoveSingle: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'file-op',
          id: 'fo4',
          op: 'move',
          status: 'done',
          ops: [{ path: 'packages/chat-ui/src/components/tool/GenericTool.tsx' }],
        },
      ]}
      height={80}
    />
  ),
};

export const MultiCollapsed: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'file-op',
          id: 'fo5',
          op: 'read',
          status: 'done',
          ops: [
            { path: 'packages/chat-ui/src/model.ts' },
            { path: 'packages/chat-ui/src/state/transcript.ts' },
            { path: 'packages/chat-ui/src/components/tool/Tool.tsx' },
          ],
        },
      ]}
      height={80}
    />
  ),
};

export const MultiExpanded: Story = {
  render: () => (
    <ChatHostExpanded
      items={[
        {
          kind: 'file-op',
          id: 'fo6',
          op: 'read',
          status: 'done',
          ops: [
            { path: 'packages/chat-ui/src/model.ts' },
            { path: 'packages/chat-ui/src/state/transcript.ts' },
            { path: 'packages/chat-ui/src/components/tool/Tool.tsx' },
          ],
        },
      ]}
      expandId="fo6"
      height={180}
    />
  ),
};

export const EditMultiExpanded: Story = {
  render: () => (
    <ChatHostExpanded
      items={[
        {
          kind: 'file-op',
          id: 'fo8',
          op: 'edit',
          status: 'done',
          ops: [
            { path: 'packages/chat-ui/src/model.ts' },
            { path: 'packages/chat-ui/src/components/row-registry.ts' },
          ],
        },
      ]}
      expandId="fo8"
      height={140}
    />
  ),
};

/** Multi-file read still in progress — shows shimmer/preview state. */
export const GeneratingPreview: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'file-op',
          id: 'fo7',
          op: 'read',
          status: 'running',
          ops: [
            { path: 'packages/chat-ui/src/model.ts' },
            { path: 'packages/chat-ui/src/state/transcript.ts' },
            { path: 'packages/chat-ui/src/components/tool/Tool.tsx' },
          ],
        },
      ]}
      height={160}
    />
  ),
};

/** Streaming new paths onto a read operation. */
export const Generating: Story = {
  render: () => (
    <ScriptedChat
      height={200}
      script={scenario(
        [seedStep([{ kind: 'message', id: 'u1', role: 'user', text: 'Explore the codebase' }])],
        streamFileOp({
          id: 'fo9',
          op: 'read',
          paths: [
            'packages/chat-ui/src/model.ts',
            'packages/chat-ui/src/state/transcript.ts',
            'packages/chat-ui/src/components/tool/Tool.tsx',
            'packages/chat-ui/src/components/thinking/Thinking.tsx',
            'packages/chat-ui/src/components/row-registry.ts',
          ],
          pathMs: 500,
        })
      )}
    />
  ),
};
