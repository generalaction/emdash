/**
 * Permission row stories — elicitation rows for agent permission requests.
 *
 * All stories are interactive: clicking "Allow once" (or any option chosen via
 * the chevron) removes the row optimistically via the harness default command.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ChatHost, ScriptedChat } from '@/stories/_harness/chat-host';
import { permissionItem } from '@/stories/_harness/permission';
import { scenario, seedStep, streamElicitation } from '@/stories/_harness/streaming/scenario';

const meta: Meta = {
  title: 'Rows/Tools/Permission',
  component: ChatHost,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof ChatHost>;

/** Standalone permission row (no parent tool call). */
export const Default: Story = {
  render: () => (
    <ChatHost
      items={[permissionItem({ title: 'Read a File' })]}
      height={80}
    />
  ),
};

/** Permission row beneath a running tool call, linked by toolCallId. */
export const BeneathToolCall: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'tool',
          id: 't-perm',
          name: 'read_file',
          status: 'running',
          inputSummary: 'src/renderer/features/tasks/chat/chat-panel.tsx',
        },
        permissionItem({ id: 'perm-beneath', toolCallId: 't-perm', title: 'Read a File' }),
      ]}
      height={120}
    />
  ),
};

/** Shows all four option tones — useful for inspecting the chevron menu visually. */
export const AllOptions: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'elicitation',
          id: 'perm-all',
          variant: 'permission' as const,
          title: 'Execute',
          defaultOptionId: 'allow-once',
          options: [
            { id: 'allow-once', label: 'Allow once', tone: 'accept' as const },
            { id: 'allow-always', label: 'Allow always', tone: 'accept' as const },
            { id: 'reject-once', label: 'Reject once', tone: 'reject' as const },
            { id: 'reject-always', label: 'Reject always', tone: 'reject' as const },
          ],
        },
      ]}
      height={80}
    />
  ),
};

/** Streaming: tool appears, then permission row arrives after a short delay. */
export const StreamedWithToolCall: Story = {
  render: () => (
    <ScriptedChat
      height={140}
      script={scenario(
        [seedStep([{ kind: 'message', id: 'u1', role: 'user', text: 'Read the config file' }])],
        streamElicitation({
          toolId: 'tool-stream',
          toolName: 'read_file',
          elicitationId: 'perm-stream',
          title: 'Read a File',
        })
      )}
    />
  ),
};

/** Long title — ellipsis truncation at the content boundary. */
export const LongTitle: Story = {
  render: () => (
    <ChatHost
      items={[
        permissionItem({
          title:
            'Execute an arbitrary shell command in the workspace root: pnpm run build --filter=emdash-desktop',
        }),
      ]}
      height={80}
    />
  ),
};
