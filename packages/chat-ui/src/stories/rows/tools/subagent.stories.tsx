/**
 * Subagent tool-call stories — ACP spawn-subagent-tool-call rendered through the generic tool row.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import type { ToolNode, ToolStatus } from '@/model';
import { ChatHost, ScriptedChat } from '@/stories/_harness/chat-host';
import { ToolNodeStateMatrix } from '@/stories/_harness/state-matrix';
import { streamToolNode, toolNodeTurn } from './tool-node-story-helpers';

const meta: Meta = {
  title: 'Rows/Tools/Subagent',
  component: ChatHost,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof ChatHost>;

function subagentNode(status: ToolStatus, id = `subagent-${status}`, background = false): ToolNode {
  return {
    kind: 'spawn-subagent-tool-call',
    id,
    seq: 0,
    toolCallId: id,
    title: 'Subagent',
    status,
    name: 'Investigate failing check',
    background,
    agentId: `agent-${id}`,
  };
}

export const StateMatrix: Story = {
  render: () => <ToolNodeStateMatrix build={(status) => subagentNode(status)} />,
};

export const Background: Story = {
  render: () => (
    <ChatHost height={80} items={[toolNodeTurn(subagentNode('running', 'subagent-bg', true))]} />
  ),
};

export const Streaming: Story = {
  render: () => (
    <ScriptedChat
      height={120}
      script={streamToolNode(subagentNode('running', 'subagent-stream'), [
        { afterMs: 900, inputSummary: 'Investigate failing check' },
        { afterMs: 900, status: 'done' },
      ])}
    />
  ),
};
