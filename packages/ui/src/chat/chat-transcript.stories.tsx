/**
 * Chat/ChatTranscript — Storybook stories.
 *
 * Uses the fully imperative renderer (no React in the hot path).
 */

import type { Meta, StoryObj } from '@storybook/react';
import React, { useEffect, useRef } from 'react';
import { generateMockTranscript } from './mock-transcript';
import type { ChatItem } from './model';
import { TranscriptStore } from './state/transcript-store';
import type { ChatSlots } from './slots';
import './chat.module.css';
import { ChatTranscript } from './view/chat-transcript';

// ── Seed data ──────────────────────────────────────────────────────────────────

const HISTORY: ChatItem[] = [
  {
    kind: 'message',
    id: 'msg-1',
    role: 'user',
    text: 'Can you explain how the projected layout model works?',
  },
  {
    kind: 'message',
    id: 'msg-2',
    role: 'assistant',
    text: `
## Projected layout

Instead of letting the browser wrap text, we compute all line breaks ourselves:

1. **Prose** — \`walkRichInlineLineRanges\` + \`materializeRichInlineLineRange\` give exact x-offsets per fragment.
2. **Code** — split on \`\\n\`, each line at a fixed \`top = padY + i * lineHeight\`.
3. **Islands** — fixed height constant, corrected once the DOM renders.

> The key invariant: \`layoutMessage\` is the **single** source of truth for height AND geometry.

Here's the core loop:

\`\`\`typescript
walkRichInlineLineRanges(prepared, width, (range) => {
  const line = materializeRichInlineLineRange(prepared, range);
  // line.fragments carry x-offsets
});
\`\`\`

No browser reflow during scroll.
`.trim(),
  },
  {
    kind: 'tool',
    id: 'tool-1',
    name: 'read_file',
    status: 'done',
    inputSummary: 'packages/ui/src/chat/layout/layout-prose.ts',
  },
  {
    kind: 'message',
    id: 'msg-3',
    role: 'user',
    text: 'What about tables?',
  },
  {
    kind: 'message',
    id: 'msg-4',
    role: 'assistant',
    text: `
Tables are treated as island blocks with DOM measure-once.

| Tier | Strategy | Who measures? |
|------|----------|---------------|
| prose | pretext rich-inline | LayoutStore |
| code | line count | LayoutStore |
| island | DOM once | IslandBlock ref |

After the first render the corrected height is cached and future scrolls are O(1).
`.trim(),
  },
];

// ── Meta ───────────────────────────────────────────────────────────────────────

type StoryArgs = { stickToBottom: boolean };

const meta = {
  title: 'Chat/ChatTranscript',
  parameters: { layout: 'fullscreen' },
  argTypes: { stickToBottom: { control: 'boolean' } },
} satisfies Meta<StoryArgs>;

export default meta;
type Story = StoryObj<StoryArgs>;

// ── Default ────────────────────────────────────────────────────────────────────

function TranscriptWrapper({ stickToBottom }: StoryArgs) {
  const store = useRef<TranscriptStore | null>(null);
  if (!store.current) {
    const s = new TranscriptStore();
    s.seed(HISTORY);
    store.current = s;
  }
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ChatTranscript store={store.current} stickToBottom={stickToBottom} />
    </div>
  );
}

export const Default: Story = {
  args: { stickToBottom: true },
  render: (args) => <TranscriptWrapper {...args} />,
};

// ── Streaming ──────────────────────────────────────────────────────────────────

const STREAM_CHUNKS = [
  'Sure! ',
  "Here's the imperative renderer at work.\n\n",
  'It starts simply enough, ',
  'but **grows** with more and more content.\n\n',
  '> Each chunk triggers a re-layout of only this message.\n\n',
  '```typescript\nconst layout = layoutStore.getLayout(item, viewState);\n```\n\n',
  'And ends cleanly.',
];

function StreamingWrapper() {
  const storeRef = useRef<TranscriptStore | null>(null);
  if (!storeRef.current) {
    const s = new TranscriptStore();
    s.seed([{ kind: 'message', id: 'seed-1', role: 'user', text: 'Show me streaming.' }]);
    storeRef.current = s;
  }
  const store = storeRef.current;

  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      if (i < STREAM_CHUNKS.length) {
        store.appendMessageChunk('assistant', 'stream-1', STREAM_CHUNKS[i++]);
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

// ── Large transcript ───────────────────────────────────────────────────────────

function LargeTranscriptWrapper() {
  const store = useRef<TranscriptStore | null>(null);
  if (!store.current) {
    const s = new TranscriptStore();
    s.seed(generateMockTranscript(6000));
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

// ── Imperative slot demo ───────────────────────────────────────────────────────

function SlotDemoWrapper() {
  const store = useRef<TranscriptStore | null>(null);
  if (!store.current) {
    const s = new TranscriptStore();
    s.seed([
      {
        kind: 'message',
        id: 'slot-msg-1',
        role: 'user',
        text: 'Show me a code block with an imperative slot override.',
      },
      {
        kind: 'message',
        id: 'slot-msg-2',
        role: 'assistant',
        text: '```typescript\nconst x = 42;\nconsole.log(x);\n```',
      },
    ]);
    store.current = s;
  }

  // Imperative slot: renderCode returns a DOM node directly.
  const slots: ChatSlots = {
    renderCode: (block) => {
      const pre = document.createElement('pre');
      pre.style.cssText =
        'background:#1e1e1e;color:#d4d4d4;padding:12px 16px;border-radius:8px;overflow-x:auto;font-size:12px;line-height:18px;';
      const code = document.createElement('code');
      code.textContent = block.code;
      pre.appendChild(code);
      // Add a "lang badge" if present
      if (block.lang) {
        const badge = document.createElement('div');
        badge.style.cssText =
          'font-size:11px;color:#6b9bd2;margin-bottom:6px;font-family:var(--chat-mono);';
        badge.textContent = block.lang;
        pre.insertBefore(badge, code);
      }
      return pre;
    },
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ChatTranscript store={store.current} slots={slots} stickToBottom={false} />
    </div>
  );
}

export const ImperativeSlotDemo: Story = {
  render: () => <SlotDemoWrapper />,
};

// ── Empty ──────────────────────────────────────────────────────────────────────

export const Empty: Story = {
  render: () => (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ChatTranscript store={new TranscriptStore()} />
    </div>
  ),
};
