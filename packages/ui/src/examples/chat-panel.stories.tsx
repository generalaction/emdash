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
import type { ChatHandle, MentionProvider } from '@emdash/chat-ui';
import { generateMockTranscript } from '@emdash/chat-ui';
import { ChatTranscript } from '@emdash/chat-ui/react';
import { ArrowDown } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChatComposer, stopReasonNotice } from '../components/chat-composer';
import type {
  ComposerAttachment,
  ComposerModelOption,
  ComposerNotice,
  ContextMentionProvider,
  MentionItem,
} from '../components/chat-composer';
import { basename, fileIconClass } from '../components/prompt-editor/mention-pill-helpers';
import type { PromptEditorRef } from '../components/prompt-editor/types';
import { Button } from '../primitives/button';

// ── Small coloured data URLs used as seeded image attachment previews ─────────

const RED_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';
const BLUE_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// ── Mock mention provider ─────────────────────────────────────────────────────

const MOCK_FILES: MentionItem[] = [
  { id: 'src/components/chat-composer.tsx', label: 'src/components/chat-composer.tsx', name: 'chat-composer.tsx', kind: 'file', description: 'UI' },
  { id: 'src/components/prompt-editor/prompt-editor.tsx', label: 'src/components/prompt-editor/prompt-editor.tsx', name: 'prompt-editor.tsx', kind: 'file', description: 'UI' },
  { id: 'src/lib/file-icons.ts', label: 'src/lib/file-icons.ts', name: 'file-icons.ts', kind: 'file' },
  { id: 'src/primitives/combobox.tsx', label: 'src/primitives/combobox.tsx', name: 'combobox.tsx', kind: 'file' },
  { id: 'src/primitives/button.tsx', label: 'src/primitives/button.tsx', name: 'button.tsx', kind: 'file' },
  { id: 'package.json', label: 'package.json', name: 'package.json', kind: 'file' },
  { id: 'README.md', label: 'README.md', name: 'README.md', kind: 'file' },
  { id: 'issue-42', label: 'issue-42', name: 'Issue #42: Dark mode toggle', kind: 'issue', description: 'open' },
  { id: 'handleSubmit', label: 'handleSubmit', name: 'handleSubmit()', kind: 'symbol', description: 'chat-composer.tsx' },
];

// ── Mock model options ────────────────────────────────────────────────────────

const MOCK_MODELS: Record<string, ComposerModelOption> = {
  'claude-opus-4': {
    name: 'Claude Opus 4',
    description: 'Most capable model for complex reasoning and nuanced tasks.',
    modelFeatures: { contextWindowSize: 200_000, speed: 0.4, intelligence: 1.0 },
  },
  'claude-sonnet-4-5': {
    name: 'Claude Sonnet 4.5',
    description: 'Excellent balance of speed and intelligence for everyday tasks.',
    modelFeatures: { contextWindowSize: 200_000, speed: 0.75, intelligence: 0.85 },
  },
  'claude-haiku-4': {
    name: 'Claude Haiku 4',
    description: 'Fast and efficient, great for high-volume straightforward tasks.',
    modelFeatures: { contextWindowSize: 200_000, speed: 0.95, intelligence: 0.65 },
  },
  'gpt-4o': {
    name: 'GPT-4o',
    description: 'OpenAI flagship multimodal model.',
    modelFeatures: { contextWindowSize: 128_000, speed: 0.7, intelligence: 0.9 },
  },
  'gpt-4o-mini': {
    name: 'GPT-4o Mini',
    description: 'Lightweight, cost-efficient GPT-4o variant.',
    modelFeatures: { contextWindowSize: 128_000, speed: 0.9, intelligence: 0.7 },
  },
  'gemini-2.5-pro': {
    name: 'Gemini 2.5 Pro',
    description: "Google's most capable model with a 1M context window.",
    modelFeatures: { contextWindowSize: 1_000_000, speed: 0.6, intelligence: 0.95 },
  },
};

/**
 * Synchronous chat-ui MentionProvider — resolves @label tokens in submitted
 * messages back to rich metadata for pill rendering in the transcript.
 * Distinct from mockMentionProvider (async, for the composer popup).
 */
const chatMentionProvider: MentionProvider = {
  resolve(token: string) {
    const match = MOCK_FILES.find((f) => f.label === token || f.name === token);
    if (!match) return null;
    // Supply the same devicon class the ChatComposer MentionPill uses for files,
    // so the transcript pill renders the exact same icon.
    const iconClass = match.kind === 'file' ? (fileIconClass(match.label) ?? undefined) : undefined;
    return {
      id: match.id,
      label: match.label,
      name: match.name ?? basename(match.label),
      kind: match.kind,
      iconClass,
    };
  },
};

const mockMentionProvider: ContextMentionProvider = {
  async search(query: string) {
    await new Promise((r) => setTimeout(r, 80)); // simulate latency
    const q = query.toLowerCase();
    return q
      ? MOCK_FILES.filter(
          (f) =>
            f.label.toLowerCase().includes(q) ||
            (f.name ?? '').toLowerCase().includes(q) ||
            (f.description ?? '').toLowerCase().includes(q)
        )
      : MOCK_FILES;
  },
};

const PAD_TOP = 16;
const PAD_BOTTOM_MARGIN = 12;

// ── Inner panel component ─────────────────────────────────────────────────────

// Seeded mock image attachments — use tiny data URLs so no network request
// is needed and the 32x32 preview row is visible in Storybook by default.
const SEED_ATTACHMENTS: ComposerAttachment[] = [
  { id: 'mock-img-1', name: 'screenshot.png', kind: 'image', previewUrl: RED_1PX },
  { id: 'mock-img-2', name: 'diagram.png', kind: 'image', previewUrl: BLUE_1PX },
];

function LiveChatPanel({ notice }: { notice?: ComposerNotice | null }) {
  const handleRef = useRef<ChatHandle | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const editorApiRef = useRef<PromptEditorRef | null>(null);
  const [composerH, setComposerH] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-5');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(SEED_ATTACHMENTS);

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
    const items = generateMockTranscript(40, 1);
    // Prepend a long user message so the collapse/expand + sticky-mirror mechanism
    // is exercisable immediately: click it to expand (360px), click outside to collapse.
    const longUserId = 'long-user-seed';
    const longUserText = [
      'Refactor the authentication module to use JWT tokens:',
      '',
      '1. Replace the session store with a signing key stored in environment variables.',
      '2. Generate tokens on login and validate them on each request via middleware.',
      '3. Store refresh tokens in an `httpOnly` cookie with a 7-day expiry.',
      '4. Add rate limiting (100 req/min per IP) to all auth endpoints.',
      '5. Write unit tests covering success, expiry, and tampered-token cases.',
      '6. Update the OpenAPI spec to document the Authorization header.',
      '7. Add `POST /auth/refresh` to renew access tokens without re-login.',
      '',
      'Start in @src/components/prompt-editor/prompt-editor.tsx and update @package.json.',
      '',
      'Preserve backward compatibility for existing sessions during the migration period.',
    ].join('\n');
    handle.transcript.seed([
      { kind: 'message', id: longUserId, role: 'user', text: longUserText },
      ...items,
    ]);
  }, []);

  // Mock onFilesDropped: insert non-image dropped files as path mentions.
  const handleFilesDropped = useCallback((files: File[]) => {
    const nonImages = files.filter((f) => !f.type.startsWith('image/'));
    nonImages.forEach((f) => {
      editorApiRef.current?.insertMention({
        id: f.name,
        label: f.name,
        name: f.name,
        kind: 'file',
      });
    });
  }, []);

  const handleSubmit = useCallback(
    (text: string) => {
      const api = handleRef.current?.transcript;
      if (!api) return;

      // Carry any staged image attachments onto the user bubble, then clear them.
      const atts = attachments
        .filter((a) => a.kind === 'image')
        .map((a) => ({ id: a.id, name: a.name, dataUrl: a.previewUrl }));

      // Append the user's message as a committed turn.
      const userId = crypto.randomUUID();
      api.dispatch({
        type: 'message_chunk',
        id: userId,
        role: 'user',
        text,
        attachments: atts.length > 0 ? atts : undefined,
      });
      api.dispatch({ type: 'turn_done' });
      setAttachments([]);

      // Echo a short canned assistant response so both roles are visible.
      const assistantId = crypto.randomUUID();
      api.dispatch({
        type: 'message_chunk',
        id: assistantId,
        role: 'assistant',
        text: text ? `Got it! You said: *${text}*` : 'Got it — received your image!',
      });
      api.dispatch({ type: 'turn_done' });
    },
    [attachments]
  );

  return (
    <div className="surface-paper relative h-full overflow-hidden rounded-xl border border-border bg-surface">
      {/* Full-bleed transcript — reserves canvas space for the floating composer */}
      <ChatTranscript
        className="absolute inset-0"
        stickToBottom
        pinUserMessages
        mentionProvider={chatMentionProvider}
        padTop={PAD_TOP}
        padBottom={composerH + PAD_BOTTOM_MARGIN}
        onReady={handleReady}
        onAtBottomChange={setAtBottom}
      />

      {/* Floating composer — aligned to the max-w-2xl content column with no
          horizontal padding so it sits flush with user message bubble edges */}
      <div
        ref={composerRef}
        className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-2xl bg-surface/80 pb-2 backdrop-blur-sm"
      >
        {/* Scroll-to-bottom affordance — floats above the composer while the
            transcript is scrolled up past the stick threshold (48px). */}
        {!atBottom && (
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full">
            <Button
              variant="primary"
              size="sm"
              icon
              aria-label="Scroll to bottom"
              onClick={() => handleRef.current?.scrollToBottom({ behavior: 'smooth' })}
              className="rounded-full shadow-md"
            >
              <ArrowDown />
            </Button>
          </div>
        )}
        <ChatComposer
          onSubmit={handleSubmit}
          mentionProvider={mockMentionProvider}
          modelOptions={MOCK_MODELS}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onFilesDropped={handleFilesDropped}
          editorApiRef={editorApiRef}
          notice={notice}
        />
      </div>
    </div>
  );
}

// ── Story meta ────────────────────────────────────────────────────────────────

const meta: Meta = {
  title: 'Examples/ChatPanel',
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

/** ACP stop reason: max_turn_requests — notice band with turn-limit error. */
export const MaxTurnRequests: Story = {
  render: () => (
    <div className="flex h-screen items-stretch p-6">
      <div className="flex-1">
        <LiveChatPanel notice={stopReasonNotice('max_turn_requests')} />
      </div>
    </div>
  ),
};

/** ACP stop reason: refusal — notice band with agent refusal error. */
export const Refusal: Story = {
  render: () => (
    <div className="flex h-screen items-stretch p-6">
      <div className="flex-1">
        <LiveChatPanel notice={stopReasonNotice('refusal')} />
      </div>
    </div>
  ),
};

/** ACP stop reason: max_tokens — notice band with response truncation error. */
export const MaxTokens: Story = {
  render: () => (
    <div className="flex h-screen items-stretch p-6">
      <div className="flex-1">
        <LiveChatPanel notice={stopReasonNotice('max_tokens')} />
      </div>
    </div>
  ),
};
