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

/**
 * A single very long line that exceeds the column width — verifies that the
 * code block clips and scrolls horizontally without overflowing the message
 * column, and that the copy button stays pinned at the top-right.
 */
export const LongLines: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'message',
          id: 'm1',
          role: 'assistant',
          text: '```typescript\nconst result = await fetchSomeData({ endpoint: "https://api.example.com/v1/this/is/a/very/long/path/that/keeps/going", headers: { Authorization: `Bearer ${token}`, "X-Request-Id": requestId, "Content-Type": "application/json" }, params: { include: "everything", expand: "deeply", format: "verbose" } });\nconst short = 1;\nconst alsoShort = true;\n```',
        },
      ]}
      height={200}
    />
  ),
};

export const Generating: Story = {
  render: () => (
    <ScriptedChat
      height={260}
      script={scenario(
        [seedStep([{ kind: 'message', id: 'u1', role: 'user', text: 'Show me a greet function' }])],
        streamMessage({ id: 'a1', text: CODE_STREAMING_BODY, chunkMs: 55 })
      )}
    />
  ),
};
