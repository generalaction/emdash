/**
 * Chat/Blocks — per-block stories for style iteration.
 *
 * Each story renders a single block type through the real layout pipeline
 * so geometry and CSS are always in sync with what the engine produces.
 *
 * A `DomHost` helper mounts the imperative DOM node, applies CSS vars, and
 * tears down on unmount. No TranscriptStore is needed — we go directly to
 * layoutMessage + renderMessage.
 */

import type { Meta, StoryObj } from '@storybook/react';
import React, { useEffect, useRef } from 'react';
import { DEFAULT_FONT_CONFIG } from './measure/fonts';
import { registerFontsReadyClear } from './measure/pretext-cache';
import { metricsToCssVars } from './metrics';
import { ViewStateStore } from './state/view-state-store';
import { renderMessage } from './dom/render-message';
import { LayoutStore } from './layout/layout-store';
import style from './chat.module.css';

// ── DomHost ───────────────────────────────────────────────────────────────────

/**
 * Mounts an imperative DOM node into a container that has the correct CSS vars
 * and the pchat-transcript root class so all var() references resolve.
 */
function DomHost({
  width = 640,
  build,
}: {
  width?: number;
  build: (container: HTMLElement) => (() => void) | void;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Apply CSS variables so layout engine measurements match rendering
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

    // pretext caches measureText widths the first time it measures, keyed only
    // by the font string. If the initial build runs before the named webfonts
    // load it bakes in fallback metrics and blocks are sized too narrow.
    // Re-measure (caches flushed) once the real fonts are ready.
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

  return (
    <div
      ref={ref}
      className={style['pchat-transcript']}
      style={{ width, position: 'relative', overflow: 'visible' }}
    />
  );
}

// ── Block story factory ───────────────────────────────────────────────────────

/**
 * Render a single assistant message (no bubble chrome) for a given markdown
 * string and container width.
 */
function renderBlock(markdown: string, containerWidth: number, host: HTMLElement): () => void {
  const fonts = DEFAULT_FONT_CONFIG;
  const layoutStore = new LayoutStore(fonts);
  const viewState = new ViewStateStore();

  layoutStore.resetForWidth(containerWidth);

  const item = {
    kind: 'message' as const,
    id: 'block-preview',
    role: 'assistant' as const,
    text: markdown,
  };

  const { node, dispose } = renderMessage(item, layoutStore, viewState, undefined, () => {});
  host.appendChild(node);
  return dispose;
}

// ── Story helpers ─────────────────────────────────────────────────────────────

type BlockStoryArgs = {
  markdown: string;
  width: number;
};

function makeStory(markdown: string): StoryObj<BlockStoryArgs> {
  return {
    args: { markdown, width: 640 },
    render({ markdown: md, width }) {
      return <DomHost width={width} build={(host) => renderBlock(md, width, host)} />;
    },
  };
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta: Meta<BlockStoryArgs> = {
  title: 'Chat/Blocks',
  argTypes: {
    markdown: { control: 'text', description: 'Markdown source for the block' },
    width: {
      control: { type: 'range', min: 200, max: 1200, step: 10 },
      description: 'Container width (px)',
    },
  },
};

export default meta;

// ── Stories ───────────────────────────────────────────────────────────────────

export const Body = makeStory(
  'This is a plain body paragraph with some regular text to show font size and line-height.'
);

export const HeadingH1 = makeStory('# Heading level 1\n\nFollowed by body text.');

export const HeadingH2 = makeStory('## Heading level 2\n\nFollowed by body text.');

export const HeadingH3 = makeStory('### Heading level 3\n\nFollowed by body text.');

export const Emphasis = makeStory(
  'Regular text, **bold text**, *italic text*, ***bold and italic***, and a [link](https://example.com).'
);

export const InlineCode = makeStory(
  'Use `const x = 42` inline and also `Array.prototype.map` to show chips.'
);

export const Mention = makeStory('Hey @alice can you review this? Also cc @bob for context.');

export const ListItem = makeStory(
  '- First item in a list\n- Second item with more content\n- Third item that is slightly longer to show wrap'
);

export const NestedList = makeStory(
  '- Top level\n  - Nested item one\n  - Nested item two\n- Back to top'
);

export const Quote = makeStory(
  '> This is a blockquote. It has a rail on the left side and indented text that should wrap correctly at the given width.'
);

export const CodeBlock = makeStory(
  '```typescript\nfunction greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n```'
);

export const CodeBlockWithLang = makeStory(
  '```python\ndef fibonacci(n: int) -> int:\n    if n <= 1:\n        return n\n    return fibonacci(n - 1) + fibonacci(n - 2)\n```'
);

export const CodeBlockLongLine = makeStory(
  '```typescript\nconst veryLongVariableName = someFunction(argumentOne, argumentTwo, argumentThree, argumentFour, argumentFive);\n```'
);

export const Table = makeStory(
  '| Name | Age | City |\n| ---- | --- | ---- |\n| Alice | 30 | New York |\n| Bob | 25 | London |\n| Carol | 35 | Tokyo |'
);

export const HorizontalRule = makeStory('Text before the rule.\n\n---\n\nText after the rule.');

export const Mixed = makeStory(
  '# Mixed content\n\nA paragraph with **bold** and `code`.\n\n- item one\n- item two\n\n```typescript\nconst x = 1;\n```\n\n> A quote to finish.'
);
