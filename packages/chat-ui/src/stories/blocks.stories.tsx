/**
 * Block-level stories — one block type per story for style iteration.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ChatHost } from './chat-host';

const meta: Meta = {
  title: 'ChatUI/Blocks',
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj;

export const BodyText: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'message',
          id: 'm1',
          role: 'assistant',
          text: 'This is a regular body paragraph with **bold**, *italic*, and `inline code` text. It also has [a link](https://example.com) inline.',
        },
      ]}
      height={120}
    />
  ),
};

export const Headings: Story = {
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

export const BulletList: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'message',
          id: 'm1',
          role: 'assistant',
          text: 'Key points:\n\n- First item in the list\n- Second item with **bold**\n- Third item with `code`\n- Fourth item that is a bit longer to test wrapping behavior',
        },
      ]}
      height={220}
    />
  ),
};

export const Blockquote: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'message',
          id: 'm1',
          role: 'assistant',
          text: '> This is a blockquote. It should have a left rail and indented text that wraps correctly at the container width.',
        },
      ]}
      height={120}
    />
  ),
};

export const CodeBlock: Story = {
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

export const CodeBlockBash: Story = {
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

export const Table: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'message',
          id: 'm1',
          role: 'assistant',
          text: '| Name | Type | Default |\n|------|------|---------|\n| `fontSize` | `number` | `14` |\n| `lineHeight` | `number` | `22` |\n| `fontFamily` | `string` | `Inter` |',
        },
      ]}
      height={200}
    />
  ),
};

export const HorizontalRule: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'message',
          id: 'm1',
          role: 'assistant',
          text: 'Section A\n\n---\n\nSection B',
        },
      ]}
      height={160}
    />
  ),
};

export const MixedBlocks: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'message',
          id: 'm1',
          role: 'assistant',
          text: '## Installation\n\nRun the following command:\n\n```bash\nnpm install @emdash/chat-ui\n```\n\nThen import and mount:\n\n```typescript\nimport { mountChat } from "@emdash/chat-ui";\nconst handle = mountChat(container);\n```\n\n> **Note**: The container must have a fixed height for the virtualizer to work correctly.',
        },
      ]}
      height={500}
    />
  ),
};
