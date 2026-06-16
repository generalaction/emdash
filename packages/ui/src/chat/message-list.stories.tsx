import type { Meta, StoryObj } from '@storybook/react';
import React, { useEffect, useRef } from 'react';
import { generateMockTranscript } from './mock-transcript';
import type { ChatItem } from './model';
import { TranscriptStore } from './state/transcript-store';
import { ChatTranscript } from './view/chat-transcript';
import '../chat/chat.css';

// ── Seed data ─────────────────────────────────────────────────────────────────

const HISTORY: ChatItem[] = [
  {
    kind: 'message',
    id: 'msg-1',
    role: 'user',
    text: 'Can you explain how the new pretext-based height model works?',
  },
  {
    kind: 'message',
    id: 'msg-2',
    role: 'assistant',
    text: `
## Height model overview

The height model uses **three tiers** to estimate block heights:

1. **Prose** — measured with \`prepareRichInline\` + \`measureRichInlineStats\`
2. **Code** — computed as \`lines * lineHeight + 2 * padY\` (no-wrap assumption)
3. **Islands** — fixed constant or DOM-measured-once

> The key invariant is that \`fonts.ts\` constants must exactly mirror \`chat.css\`.

Here's a tiny example in TypeScript:

\`\`\`typescript
const stats = measureRichInlineStats(prepared, containerWidth);
const height = stats.lineCount * BODY_LINE_HEIGHT;
\`\`\`

That's all there is to it!
`.trim(),
  },
  {
    kind: 'tool',
    id: 'tool-1',
    name: 'read_file',
    status: 'done',
    inputSummary: 'packages/ui/src/chat/measure/fonts.ts',
    detail: '// font constants file contents …',
  },
  {
    kind: 'tool',
    id: 'tool-2',
    name: 'write_file',
    status: 'error',
    inputSummary: 'packages/ui/src/chat/index.ts',
  },
  {
    kind: 'message',
    id: 'msg-3',
    role: 'user',
    text: 'What about tables and math?',
  },
  {
    kind: 'message',
    id: 'msg-4',
    role: 'assistant',
    text: `
Tables and math are treated as **island** blocks.

| Block type | Strategy           |
|------------|--------------------|
| table      | DOM measure-once   |
| math       | fixed window       |
| mermaid    | fixed window       |
| image      | DOM measure-once   |

For inline math like $E = mc^2$ we fall back to a mention chip.
`.trim(),
  },
];

// ── Base story setup ──────────────────────────────────────────────────────────

type StoryArgs = { stickToBottom: boolean };

const meta = {
  title: 'Chat/ChatTranscript',
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    stickToBottom: { control: 'boolean' },
  },
} satisfies Meta<StoryArgs>;

export default meta;
type Story = StoryObj<StoryArgs>;

// ── Stories ───────────────────────────────────────────────────────────────────

function makeStore(history: ChatItem[] = HISTORY): TranscriptStore {
  const store = new TranscriptStore();
  store.seed(history);
  return store;
}

/** Wrapper so we can instantiate a store per story */
function TranscriptWrapper({ stickToBottom }: StoryArgs) {
  const store = useRef(makeStore()).current;
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ChatTranscript store={store} stickToBottom={stickToBottom} />
    </div>
  );
}

export const Default: Story = {
  args: { stickToBottom: true },
  render: (args) => <TranscriptWrapper {...args} />,
};

// ── Streaming simulation story ────────────────────────────────────────────────

function StreamingWrapper() {
  const storeRef = useRef<TranscriptStore | null>(null);
  if (!storeRef.current) {
    const s = new TranscriptStore();
    s.seed([{ kind: 'message', id: 'seed-1', role: 'user', text: 'Tell me something long.' }]);
    storeRef.current = s;
  }
  const store = storeRef.current;

  useEffect(() => {
    const CHUNKS = [
      'Sure! ',
      "Here's a long reply.\n\n",
      'It starts simply enough, ',
      'but then **grows** with more and more content.\n\n',
      '> This is a blockquote paragraph.\n\n',
      '```typescript\nconst x = 42;\nconsole.log(x);\n```\n\n',
      'And then ends.',
    ];
    let i = 0;
    const interval = setInterval(() => {
      if (i < CHUNKS.length) {
        store.appendMessageChunk('assistant', 'stream-msg-1', CHUNKS[i++]);
      } else {
        store.finalizeTurn();
        clearInterval(interval);
      }
    }, 300);
    return () => clearInterval(interval);
  }, [store]);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ChatTranscript store={store} stickToBottom />
    </div>
  );
}

export const Streaming: Story = {
  render: () => <StreamingWrapper />,
};

// ── Large transcript (virtualization stress test) ──────────────────────────────

function LargeTranscriptWrapper() {
  const store = useRef<TranscriptStore | null>(null);
  if (!store.current) {
    const s = new TranscriptStore();
    s.seed(generateMockTranscript(10000));
    store.current = s;
  }
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ChatTranscript store={store.current} stickToBottom={false} />
    </div>
  );
}

export const LargeTranscript: Story = {
  render: () => <LargeTranscriptWrapper />,
};

// ── Collapse interaction story ─────────────────────────────────────────────────

export const Empty: Story = {
  render: () => {
    const store = new TranscriptStore();
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <ChatTranscript store={store} />
      </div>
    );
  },
};
