/**
 * Chat/Rows — per-row stories for style iteration.
 *
 * Covers all row types: user (short + long), assistant, thought, streaming,
 * and tool rows (running / done / error, with and without detail).
 *
 * User rows verify that the bubble hugs + wraps correctly after the bubble-fix.
 */

import type { Meta, StoryObj } from '@storybook/react';
import React, { useEffect, useRef } from 'react';
import { DEFAULT_FONT_CONFIG } from './measure/fonts';
import { registerFontsReadyClear } from './measure/pretext-cache';
import { metricsToCssVars } from './metrics';
import type { ChatMessage, ChatRole, ChatToolCall, ToolStatus } from './model';
import { ViewStateStore } from './state/view-state-store';
import { renderMessage } from './dom/render-message';
import { renderTool } from './dom/render-tool';
import { LayoutStore } from './layout/layout-store';
import style from './chat.module.css';

// ── DomHost ───────────────────────────────────────────────────────────────────

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
    // load it bakes in fallback metrics and the bubble is sized too narrow.
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

// ── Message row factory ───────────────────────────────────────────────────────

function buildMessageRow(
  text: string,
  role: ChatRole,
  streaming: boolean,
  containerWidth: number,
  host: HTMLElement
): () => void {
  const fonts = DEFAULT_FONT_CONFIG;
  const layoutStore = new LayoutStore(fonts);
  const viewState = new ViewStateStore();
  layoutStore.resetForWidth(containerWidth);

  const item: ChatMessage = {
    kind: 'message',
    id: 'row-preview',
    role,
    text,
    streaming: streaming || undefined,
  };

  const { node, dispose } = renderMessage(item, layoutStore, viewState, undefined, () => {});
  host.appendChild(node);
  return dispose;
}

// ── Tool row factory ──────────────────────────────────────────────────────────

function buildToolRow(
  name: string,
  status: ToolStatus,
  inputSummary: string | undefined,
  detail: string | undefined,
  host: HTMLElement
): void {
  const item: ChatToolCall = {
    kind: 'tool',
    id: 'tool-preview',
    name,
    status,
    inputSummary,
    detail,
  };
  host.appendChild(renderTool(item));
}

// ── Types ─────────────────────────────────────────────────────────────────────

type MessageRowArgs = {
  text: string;
  role: ChatRole;
  streaming: boolean;
  width: number;
};

type ToolRowArgs = {
  name: string;
  status: ToolStatus;
  inputSummary: string;
  detail: string;
  showDetail: boolean;
  width: number;
};

// ── Meta ──────────────────────────────────────────────────────────────────────

const messageMeta: Meta<MessageRowArgs> = {
  title: 'Chat/Rows',
  argTypes: {
    text: { control: 'text' },
    role: { control: 'select', options: ['user', 'assistant', 'thought'] },
    streaming: { control: 'boolean' },
    width: { control: { type: 'range', min: 200, max: 1200, step: 10 } },
  },
};

export default messageMeta;

// ── Message stories ───────────────────────────────────────────────────────────

export const UserShort: StoryObj<MessageRowArgs> = {
  args: { text: 'Hi there!', role: 'user', streaming: false, width: 640 },
  render({ text, role, streaming, width }) {
    return (
      <DomHost
        width={width}
        build={(host) => buildMessageRow(text, role, streaming, width, host)}
      />
    );
  },
};

export const UserLong: StoryObj<MessageRowArgs> = {
  args: {
    text: 'Can you help me refactor the authentication service so it handles token refresh automatically, and also add proper error handling for network failures?',
    role: 'user',
    streaming: false,
    width: 640,
  },
  render({ text, role, streaming, width }) {
    return (
      <DomHost
        width={width}
        build={(host) => buildMessageRow(text, role, streaming, width, host)}
      />
    );
  },
};

export const UserMultiLine: StoryObj<MessageRowArgs> = {
  args: {
    text: 'Please fix these issues:\n1. The button is not clickable\n2. The form resets on submit\n3. The modal does not close',
    role: 'user',
    streaming: false,
    width: 640,
  },
  render({ text, role, streaming, width }) {
    return (
      <DomHost
        width={width}
        build={(host) => buildMessageRow(text, role, streaming, width, host)}
      />
    );
  },
};

export const Assistant: StoryObj<MessageRowArgs> = {
  args: {
    text: "I'll help you with that. Here's a refactored version of the authentication service:\n\n```typescript\nclass AuthService {\n  async refreshToken(): Promise<void> {\n    // implementation\n  }\n}\n```\n\nThis approach handles token refresh automatically.",
    role: 'assistant',
    streaming: false,
    width: 640,
  },
  render({ text, role, streaming, width }) {
    return (
      <DomHost
        width={width}
        build={(host) => buildMessageRow(text, role, streaming, width, host)}
      />
    );
  },
};

export const Thought: StoryObj<MessageRowArgs> = {
  args: {
    text: "Let me think about the best approach for this. The user wants token refresh to be automatic, which means I'll need to intercept 401 responses and retry with a fresh token.",
    role: 'thought',
    streaming: false,
    width: 640,
  },
  render({ text, role, streaming, width }) {
    return (
      <DomHost
        width={width}
        build={(host) => buildMessageRow(text, role, streaming, width, host)}
      />
    );
  },
};

export const Streaming: StoryObj<MessageRowArgs> = {
  args: {
    text: "I'm working on the implementation right now. The key insight is",
    role: 'assistant',
    streaming: true,
    width: 640,
  },
  render({ text, role, streaming, width }) {
    return (
      <DomHost
        width={width}
        build={(host) => buildMessageRow(text, role, streaming, width, host)}
      />
    );
  },
};

// ── Tool row stories ──────────────────────────────────────────────────────────

type ToolStory = StoryObj<ToolRowArgs>;

function ToolRow(props: ToolRowArgs): React.ReactElement {
  return (
    <DomHost
      width={props.width}
      build={(host) =>
        buildToolRow(
          props.name,
          props.status,
          props.inputSummary || undefined,
          props.showDetail && props.detail ? props.detail : undefined,
          host
        )
      }
    />
  );
}

const toolDefaults: ToolRowArgs = {
  name: 'read_file',
  status: 'running',
  inputSummary: 'src/auth/service.ts',
  detail: '{\n  "path": "src/auth/service.ts",\n  "encoding": "utf-8"\n}',
  showDetail: false,
  width: 640,
};

export const ToolRunning: ToolStory = {
  args: { ...toolDefaults, status: 'running' },
  render: (args) => <ToolRow {...args} />,
};

export const ToolDone: ToolStory = {
  args: { ...toolDefaults, status: 'done' },
  render: (args) => <ToolRow {...args} />,
};

export const ToolError: ToolStory = {
  args: { ...toolDefaults, status: 'error', inputSummary: 'File not found' },
  render: (args) => <ToolRow {...args} />,
};

export const ToolWithDetail: ToolStory = {
  args: {
    ...toolDefaults,
    name: 'write_file',
    status: 'done',
    inputSummary: 'src/auth/service.ts (+42 lines)',
    showDetail: true,
  },
  render: (args) => <ToolRow {...args} />,
};
