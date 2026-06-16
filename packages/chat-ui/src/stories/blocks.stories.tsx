/**
 * Block-level stories — one block type per story for style iteration.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ChatHost, ScriptedChat } from './chat-host';
import { scenario, seedStep, streamMessage } from './streaming/scenario';

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

// 8 columns — exercises horizontal scroll when container is narrower than tableWidth.
export const TableWide: Story = {
  name: 'Table – wide (8 columns)',
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'message',
          id: 'm1',
          role: 'assistant',
          text: [
            '| Alpha | Beta | Gamma | Delta | Epsilon | Zeta | Eta | Theta |',
            '|-------|------|-------|-------|---------|------|-----|-------|',
            '| aaa-1 | bbb-1 | ccc-1 | ddd-1 | eee-1 | fff-1 | ggg-1 | hhh-1 |',
            '| aaa-2 | bbb-2 | ccc-2 | ddd-2 | eee-2 | fff-2 | ggg-2 | hhh-2 |',
            '| This cell has a very long value that should be truncated with an ellipsis | short | short | short | short | short | short | short |',
          ].join('\n'),
        },
      ]}
      height={200}
    />
  ),
};

// 20 rows — verifies formula height calculation for tall tables.
export const TableTall: Story = {
  name: 'Table – tall (20 rows)',
  render: () => {
    const header = '| # | Item | Status | Notes |';
    const sep = '|---|------|--------|-------|';
    const rows = Array.from(
      { length: 20 },
      (_, i) =>
        `| ${i + 1} | Item ${i + 1} | ${i % 3 === 0 ? 'Done' : i % 3 === 1 ? 'In progress' : 'Pending'} | Some note for row ${i + 1} |`
    );
    return (
      <ChatHost
        items={[
          {
            kind: 'message',
            id: 'm1',
            role: 'assistant',
            text: [header, sep, ...rows].join('\n'),
          },
        ]}
        height={800}
      />
    );
  },
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

export const CodeBlockStreaming: Story = {
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

const TABLE_STREAMING_BODY = [
  'Comparison of authentication strategies:\n\n',
  '| Strategy | Stateless | Revocable | Complexity |\n',
  '|----------|-----------|-----------|------------|\n',
  '| JWT | Yes | No | Low |\n',
  '| Session | No | Yes | Low |\n',
  '| OAuth | Yes | Yes | High |\n',
].join('');

export const TableStreaming: Story = {
  render: () => (
    <ScriptedChat
      height={280}
      script={scenario(
        [
          seedStep([
            {
              kind: 'message',
              id: 'u1',
              role: 'user',
              text: 'Compare authentication strategies',
            },
          ]),
        ],
        streamMessage({ id: 'a1', text: TABLE_STREAMING_BODY, chunkMs: 55 })
      )}
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

/**
 * Demonstrates that a single `\n` within a paragraph produces a tight line
 * break (not a new paragraph), while `\n\n` (double newline) produces a
 * paragraph with a smaller PROSE_GAP between them, and non-prose blocks
 * (code fence) keep the larger BLOCK_GAP on both sides.
 */
export const LineBreaksAndParagraphGap: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'message',
          id: 'm1',
          role: 'assistant',
          text: [
            'First line of a paragraph.',
            'Second line — same paragraph, soft break (single \\n).',
            'Third line — still the same paragraph.',
            '',
            'This is a new paragraph after a blank line (`\\n\\n`).',
            'It should have a small gap above, not a big block gap.',
            '',
            'Another paragraph here.',
            '',
            '```ts',
            'const x = 1; // code block follows with a larger gap',
            '```',
            '',
            'Back to prose after the code fence — larger gap above.',
          ].join('\n'),
        },
      ]}
      height={460}
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
