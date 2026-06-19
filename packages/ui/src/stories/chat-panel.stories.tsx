/**
 * ChatPanel — composed story combining ChatTranscript (from @emdash/chat-ui)
 * with ChatComposer (from @emdash/ui), mirroring the desktop chat-panel layout.
 *
 * CSS load order:
 *   1. devicon/devicon.min.css  — file icons for diff / resource-link headers
 *   2. @emdash/chat-ui/style.css — prebuilt chat-ui utility bundle
 *   3. @emdash/chat-ui/chat-theme.css — binds --chat-* → @emdash/ui semantic tokens
 *
 * The @emdash/ui base tokens (theme.css / semantic.css) and the .emlight /
 * .emdark wrapper class come from the global ThemeProvider decorator in
 * .storybook/preview.tsx, so chat-theme.css resolves var(--foreground) etc.
 * correctly without any extra imports here.
 *
 * Build-order note: @emdash/chat-ui must be built (pnpm --filter @emdash/chat-ui build)
 * before running this Storybook so that ./dist/react.js resolves.
 */

import 'devicon/devicon.min.css';
import '@emdash/chat-ui/style.css';
import '@emdash/chat-ui/chat-theme.css';

import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ChatHandle } from '@emdash/chat-ui/react';
import { ChatTranscript } from '@emdash/chat-ui/react';
import { generateMockTranscript } from '@emdash/chat-ui';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChatComposer } from '../components/chat-composer';

const PAD_TOP = 16;
const PAD_BOTTOM_MARGIN = 12;

// ── Inner panel component ─────────────────────────────────────────────────────

function LiveChatPanel() {
  const handleRef = useRef<ChatHandle | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerH, setComposerH] = useState(0);

  // Measure the floating composer so the transcript can reserve matching space.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.borderBoxSize[0]?.blockSize ?? entries[0]?.contentRect.height ?? 0;
      setComposerH(Math.round(h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleReady = useCallback((handle: ChatHandle) => {
    handleRef.current = handle;
    handle.transcript.seed(generateMockTranscript(40, 1));
  }, []);

  const handleSubmit = useCallback((text: string) => {
    const api = handleRef.current?.transcript;
    if (!api) return;

    // Append the user's message as a committed turn.
    const userId = crypto.randomUUID();
    api.dispatch({ type: 'message_chunk', id: userId, role: 'user', text });
    api.dispatch({ type: 'turn_done' });

    // Echo a short canned assistant response so both roles are visible.
    const assistantId = crypto.randomUUID();
    api.dispatch({
      type: 'message_chunk',
      id: assistantId,
      role: 'assistant',
      text: `Got it! You said: *${text}*`,
    });
    api.dispatch({ type: 'turn_done' });
  }, []);

  return (
    <div className="surface-base relative h-full overflow-hidden rounded-xl border border-border bg-surface">
      {/* Full-bleed transcript — reserves canvas space for the floating composer */}
      <ChatTranscript
        className="absolute inset-0"
        stickToBottom
        padTop={PAD_TOP}
        padBottom={composerH + PAD_BOTTOM_MARGIN}
        onReady={handleReady}
      />

      {/* Floating composer — aligned to the max-w-2xl content column with no
          horizontal padding so it sits flush with user message bubble edges */}
      <div
        ref={composerRef}
        className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-2xl bg-surface/80 pb-3 backdrop-blur-sm"
      >
        <ChatComposer onSubmit={handleSubmit} />
      </div>
    </div>
  );
}

// ── Story meta ────────────────────────────────────────────────────────────────

const meta: Meta = {
  title: 'Composed/ChatPanel',
  parameters: {
    // Fill the preview pane so the panel can use full height.
    layout: 'fullscreen',
  },
};
export default meta;

type Story = StoryObj;

/**
 * Live panel — type a message and press Enter (or click Send) to append it to
 * the transcript. The panel seeds a 40-item mock transcript on first mount.
 * Use the color-mode toolbar to switch between light and dark themes.
 */
export const Live: Story = {
  render: () => (
    <div className="flex h-screen items-stretch p-6">
      <div className="flex-1">
        <LiveChatPanel />
      </div>
    </div>
  ),
};
