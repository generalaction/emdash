/**
 * CodeBlock block stories.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ChatHost, ScriptedChat } from '../../../chat-host';
import { scenario, seedStep, streamMessage } from '../../../streaming/scenario';

const meta: Meta = {
  title: 'Rows/Markdown/Blocks/CodeBlock',
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
          text: '```typescript\nfunction greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet("World"));\n```',
        },
      ]}
      height={200}
    />
  ),
};

export const Bash: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'message',
          id: 'm1',
          role: 'assistant',
          text: '```bash\n# Install dependencies\nnpm install\n\n# Run development server\nnpm run dev\n```',
        },
      ]}
      height={180}
    />
  ),
};

const CODE_STREAMING_BODY = [
  'Here is the implementation:\n\n',
  '```typescript\n',
  'function greet(name: string): string {\n',
  '  return `Hello, ${name}!`;\n',
  '}\n',
  '\n',
  'console.log(greet("World"));\n',
  '```\n\n',
  'Call `greet` with any name string.',
].join('');

export const Generating: Story = {
  render: () => (
    <ScriptedChat
      height={260}
      script={scenario(
        [
          seedStep([
            { kind: 'message', id: 'u1', role: 'user', text: 'Show me a greet function' },
          ]),
        ],
        streamMessage({ id: 'a1', text: CODE_STREAMING_BODY, chunkMs: 55 })
      )}
    />
  ),
};
