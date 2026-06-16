/**
 * Chat/Code — syntax-highlighting stories.
 *
 * Sections:
 *  - Per-language stories (TypeScript, JavaScript, Python, JSON, Bash)
 *  - UnknownLanguage  — plain-text fallback for unsupported langs
 *  - LongLines        — horizontal scroll with token spans
 *  - StreamingCode    — live re-highlighting during streaming + cursor
 *
 * Static stories use the same DomHost pattern as blocks.stories.tsx:
 * a real renderBlock() call through the full layout + render pipeline.
 * The `theme` arg adds / removes a `dark` class on the host container so
 * light and dark modes can be toggled in the Storybook controls panel.
 *
 * The StreamingCode story uses the ScriptedChat scaffold from thinking.stories.tsx
 * and streams a fenced TypeScript block chunk-by-chunk via appendMessageChunk.
 */

import type { Meta, StoryObj } from '@storybook/react';
import { action } from 'mobx';
import React, { useEffect, useRef } from 'react';
import type { ChatItem } from './model';
import { DEFAULT_FONT_CONFIG } from './measure/fonts';
import { registerFontsReadyClear } from './measure/pretext-cache';
import { metricsToCssVars } from './metrics';
import { ViewStateStore } from './state/view-state-store';
import { TranscriptStore } from './state/transcript-store';
import { LayoutStore } from './layout/layout-store';
import { renderMessage } from './dom/render-message';
import { ChatTranscript } from './view/chat-transcript';
import style from './chat.module.css';

// ── DomHost ───────────────────────────────────────────────────────────────────

function DomHost({
  width = 700,
  theme = 'light',
  build,
}: {
  width?: number;
  theme?: 'light' | 'dark';
  build: (container: HTMLElement) => (() => void) | void;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const vars = metricsToCssVars();
    for (const [k, v] of Object.entries(vars)) {
      el.style.setProperty(k, v);
    }

    let cleanup = build(el);
    let disposed = false;

    const clear = () => {
      if (typeof cleanup === 'function') cleanup();
      while (el.firstChild) el.firstChild.remove();
    };

    registerFontsReadyClear(() => {
      if (disposed) return;
      clear();
      cleanup = build(el);
    });

    return () => {
      disposed = true;
      clear();
    };
    // Intentionally run once: `build` is a stable closure per render cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Toggle .dark class based on the theme arg.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  return (
    <div
      ref={ref}
      className={`${style['pchat-transcript']}${theme === 'dark' ? ' dark' : ''}`}
      style={{ width, position: 'relative', overflow: 'visible' }}
    />
  );
}

// ── Story helpers ─────────────────────────────────────────────────────────────

function renderBlock(markdown: string, containerWidth: number, host: HTMLElement): () => void {
  const fonts = DEFAULT_FONT_CONFIG;
  const layoutStore = new LayoutStore(fonts);
  const viewState = new ViewStateStore();
  layoutStore.resetForWidth(containerWidth);

  const item = {
    kind: 'message' as const,
    id: 'code-preview',
    role: 'assistant' as const,
    text: markdown,
  };

  const { node, dispose } = renderMessage(item, layoutStore, viewState, undefined, () => {});
  host.appendChild(node);
  return dispose;
}

type CodeStoryArgs = {
  width: number;
  theme: 'light' | 'dark';
};

function makeStory(markdown: string): StoryObj<CodeStoryArgs> {
  return {
    args: { width: 700, theme: 'light' },
    render({ width, theme }) {
      return (
        <DomHost width={width} theme={theme} build={(host) => renderBlock(markdown, width, host)} />
      );
    },
  };
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta: Meta<CodeStoryArgs> = {
  title: 'Chat/Code',
  parameters: { layout: 'centered' },
  argTypes: {
    width: {
      control: { type: 'range', min: 300, max: 1200, step: 10 },
      description: 'Container width (px)',
    },
    theme: {
      control: { type: 'radio' },
      options: ['light', 'dark'],
      description: 'Color theme',
    },
  },
};

export default meta;

// ── Per-language stories ──────────────────────────────────────────────────────

export const TypeScript = makeStory(
  [
    '```typescript',
    'interface User {',
    '  id: number;',
    '  name: string;',
    '  email?: string;',
    '}',
    '',
    'async function fetchUser(id: number): Promise<User> {',
    '  const res = await fetch(`/api/users/${id}`);',
    '  if (!res.ok) throw new Error(`HTTP ${res.status}`);',
    '  return res.json() as Promise<User>;',
    '}',
    '```',
  ].join('\n')
);

export const JavaScript = makeStory(
  [
    '```javascript',
    'const debounce = (fn, delay) => {',
    '  let timer;',
    '  return (...args) => {',
    '    clearTimeout(timer);',
    '    timer = setTimeout(() => fn(...args), delay);',
    '  };',
    '};',
    '',
    'const search = debounce((query) => {',
    "  console.log('searching:', query);",
    '}, 300);',
    '```',
  ].join('\n')
);

export const Python = makeStory(
  [
    '```python',
    'from dataclasses import dataclass',
    'from typing import Optional',
    '',
    '@dataclass',
    'class Config:',
    '    host: str = "localhost"',
    '    port: int = 8080',
    '    debug: bool = False',
    '    api_key: Optional[str] = None',
    '',
    'def load_config(path: str) -> Config:',
    '    import json',
    '    with open(path) as f:',
    '        return Config(**json.load(f))',
    '```',
  ].join('\n')
);

export const JSON = makeStory(
  [
    '```json',
    '{',
    '  "name": "my-project",',
    '  "version": "1.0.0",',
    '  "scripts": {',
    '    "dev": "vite",',
    '    "build": "tsc && vite build",',
    '    "test": "vitest"',
    '  },',
    '  "dependencies": {',
    '    "react": "^19.0.0",',
    '    "mobx": "^6.16.1"',
    '  }',
    '}',
    '```',
  ].join('\n')
);

export const Bash = makeStory(
  [
    '```bash',
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"',
    '',
    'echo "Building in $REPO_DIR"',
    '',
    'pnpm install --frozen-lockfile',
    'pnpm run typecheck',
    'pnpm run lint',
    'pnpm run build',
    '',
    'echo "Done."',
    '```',
  ].join('\n')
);

export const UnknownLanguage = makeStory(
  [
    '```rust',
    'fn fibonacci(n: u64) -> u64 {',
    '    match n {',
    '        0 => 0,',
    '        1 => 1,',
    '        _ => fibonacci(n - 1) + fibonacci(n - 2),',
    '    }',
    '}',
    '```',
  ].join('\n')
);
UnknownLanguage.name = 'Unknown Language (plain-text fallback)';

export const LongLines = makeStory(
  [
    '```typescript',
    'const result = await someVeryLongFunctionNameThatDoesLotsOfWork(firstArgument, secondArgument, { thirdOption: true, fourthOption: "some long string value here" });',
    "const anotherLongLine = Object.entries(someObject).filter(([key, value]) => key.startsWith('prefix_') && value !== null && value !== undefined).map(([key, value]) => ({ key, value, normalized: String(value).trim() }));",
    '```',
  ].join('\n')
);
LongLines.name = 'Long Lines (horizontal scroll)';

// ── Streaming story ───────────────────────────────────────────────────────────

// Chunks that arrive one-by-one to simulate a streaming TypeScript code block.
const STREAMING_CHUNKS = [
  'Here is a binary search implementation:\n\n',
  '```typescript\n',
  'function binarySearch(\n',
  '  arr: number[],\n',
  '  target: number\n',
  '): number {\n',
  '  let left = 0;\n',
  '  let right = arr.length - 1;\n',
  '\n',
  '  while (left <= right) {\n',
  '    const mid = Math.floor((left + right) / 2);\n',
  '    if (arr[mid] === target) return mid;\n',
  '    if (arr[mid] < target) {\n',
  '      left = mid + 1;\n',
  '    } else {\n',
  '      right = mid - 1;\n',
  '    }\n',
  '  }\n',
  '\n',
  '  return -1;\n',
  '}\n',
  '```\n',
  '\nTime complexity: **O(log n)**.',
];

function ScriptedChat({
  height = 520,
  width = 700,
}: {
  height?: number;
  width?: number;
}): React.ReactElement {
  const transcriptRef = useRef<TranscriptStore | null>(null);
  const layoutRef = useRef<LayoutStore | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  if (!transcriptRef.current) transcriptRef.current = new TranscriptStore();
  if (!layoutRef.current) layoutRef.current = new LayoutStore();

  const transcript = transcriptRef.current;

  useEffect(() => {
    const timers = timersRef.current;
    let delay = 0;
    const CHUNK_INTERVAL = 120; // ms between chunks

    action(() => {
      // Seed a user message first.
      transcript.seed([
        {
          kind: 'message',
          id: 'user-1',
          role: 'user',
          text: 'Can you show me a binary search in TypeScript?',
        } satisfies ChatItem,
      ]);
    })();

    // Start streaming the assistant reply.
    action(() => {
      transcript.appendMessageChunk('assistant', 'assistant-1', '');
    })();

    for (const chunk of STREAMING_CHUNKS) {
      delay += CHUNK_INTERVAL;
      timers.push(
        setTimeout(
          action(() => {
            transcript.appendMessageChunk('assistant', 'assistant-1', chunk);
          }),
          delay
        )
      );
    }

    // Finalize after all chunks have arrived.
    delay += CHUNK_INTERVAL + 200;
    timers.push(
      setTimeout(
        action(() => {
          transcript.finalizeTurn();
        }),
        delay
      )
    );

    return () => {
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
      action(() => transcript.reset())();
    };
    // Intentionally run once on mount — transcript is a stable ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ width, height, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
      <ChatTranscript store={transcript} layoutStore={layoutRef.current ?? undefined} />
    </div>
  );
}

export const StreamingCode: StoryObj = {
  name: 'Streaming Code Block',
  render: () => <ScriptedChat />,
};

export const StreamingCodeDark: StoryObj = {
  name: 'Streaming Code Block (dark)',
  render: () => (
    <div className="dark">
      <ScriptedChat />
    </div>
  ),
};
