/**
 * Headings block stories.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ChatHost, ScriptedChat } from '../../../chat-host';
import { scenario, seedStep, streamMessage } from '../../../streaming/scenario';

const meta: Meta = {
  title: 'Rows/Markdown/Blocks/Headings',
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'message',
          id: 'm1',
          role: 'assistant',
          text: '# Heading 1\n\n## Heading 2\n\n### Heading 3\n\nBody text follows headings.',
        },
      ]}
      height={200}
    />
  ),
};

const HEADINGS_STREAMING = [
  '# Heading 1\n\n',
  '## Heading 2\n\n',
  '### Heading 3\n\n',
  'Body text follows headings.',
].join('');

export const Generating: Story = {
  render: () => (
    <ScriptedChat
      height={200}
      script={scenario(
        [seedStep([{ kind: 'message', id: 'u1', role: 'user', text: 'Show me heading examples' }])],
        streamMessage({ id: 'a1', text: HEADINGS_STREAMING, chunkMs: 60 })
      )}
    />
  ),
};
