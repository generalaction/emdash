/**
 * ChatPanel — composed story combining ChatTranscript (from @emdash/ui/react/chat-ui)
 * with ChatComposer (from @emdash/ui), mirroring the desktop chat-panel layout.
 */
import type { ChatCommands, ChatHandle, MentionProvider } from '@emdash/chat-ui';
import { generateMockTranscript } from '@emdash/chat-ui';
import { ChatTranscript } from '@react/chat-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { cx } from '@styles/utilities/cx';
import { ArrowDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatComposer, stopReasonNotice } from '../components/chat-composer';
import type {
  ComposerAttachment,
  ComposerModelOption,
  ComposerNotice,
  ContextMentionProvider,
  MentionItem,
} from '../components/chat-composer';
import { ImageViewerDialog } from '../components/image-viewer-dialog';
import type { ComposerPermissionRequest } from '../components/permission-band';
import { basename, fileIconClass } from '../components/prompt-editor/mention-pill-helpers';
import type { PromptEditorRef } from '../components/prompt-editor/types';
import { Box } from '../primitives/box';
import { Button } from '../primitives/button';
import * as s from '../story-layout.css';
import { sx } from '@styles/utilities/sprinkles.css';

const RED_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';
const BLUE_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const MOCK_FILES: MentionItem[] = [
  {
    id: 'src/components/chat-composer.tsx',
    label: 'src/components/chat-composer.tsx',
    name: 'chat-composer.tsx',
    kind: 'file',
    description: 'UI',
  },
  {
    id: 'src/components/prompt-editor/prompt-editor.tsx',
    label: 'src/components/prompt-editor/prompt-editor.tsx',
    name: 'prompt-editor.tsx',
    kind: 'file',
    description: 'UI',
  },
  {
    id: 'src/lib/file-icons.ts',
    label: 'src/lib/file-icons.ts',
    name: 'file-icons.ts',
    kind: 'file',
  },
  {
    id: 'src/primitives/combobox.tsx',
    label: 'src/primitives/combobox.tsx',
    name: 'combobox.tsx',
    kind: 'file',
  },
  {
    id: 'src/primitives/button.tsx',
    label: 'src/primitives/button.tsx',
    name: 'button.tsx',
    kind: 'file',
  },
  { id: 'package.json', label: 'package.json', name: 'package.json', kind: 'file' },
  { id: 'README.md', label: 'README.md', name: 'README.md', kind: 'file' },
  {
    id: 'issue-42',
    label: 'issue-42',
    name: 'Issue #42: Dark mode toggle',
    kind: 'issue',
    description: 'open',
  },
  {
    id: 'handleSubmit',
    label: 'handleSubmit',
    name: 'handleSubmit()',
    kind: 'symbol',
    description: 'chat-composer.tsx',
  },
];

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

const chatMentionProvider: MentionProvider = {
  resolve(token: string) {
    const match = MOCK_FILES.find((f) => f.label === token || f.name === token);
    if (!match) return null;
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
    await new Promise((r) => setTimeout(r, 80));
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

const SEED_ATTACHMENTS: ComposerAttachment[] = [
  { id: 'mock-img-1', name: 'screenshot.png', kind: 'image', previewUrl: RED_1PX },
  { id: 'mock-img-2', name: 'diagram.png', kind: 'image', previewUrl: BLUE_1PX },
];

function LiveChatPanel({
  notice,
  permissionRequest,
  permissionQueueCount,
}: {
  notice?: ComposerNotice | null;
  permissionRequest?: ComposerPermissionRequest | null;
  permissionQueueCount?: number;
}) {
  const handleRef = useRef<ChatHandle | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const editorApiRef = useRef<PromptEditorRef | null>(null);
  const [composerH, setComposerH] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-5');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(SEED_ATTACHMENTS);
  const [viewer, setViewer] = useState<{ src?: string; alt?: string } | null>(null);

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

  const commands = useMemo(
    (): ChatCommands => ({
      onViewImage: ({ attachment }) => setViewer({ src: attachment.dataUrl, alt: attachment.name }),
    }),
    []
  );

  const handleReady = useCallback((handle: ChatHandle) => {
    handleRef.current = handle;
    const items = generateMockTranscript(40, 1);
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
      { kind: 'message', id: 'long-user-seed', role: 'user', text: longUserText },
      {
        kind: 'message',
        id: 'seed-img-user',
        role: 'user',
        text: 'Here are two screenshots.',
        attachments: [
          { id: 'a1', name: 'screenshot.png', dataUrl: RED_1PX },
          { id: 'a2', name: 'diagram.png', dataUrl: BLUE_1PX },
        ],
      },
      ...items,
    ]);
  }, []);

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
      const atts = attachments
        .filter((a) => a.kind === 'image')
        .map((a) => ({ id: a.id, name: a.name, dataUrl: a.previewUrl }));
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
    <Box
      surface="paper"
      position="relative"
      height="full"
      overflow="hidden"
      rounded="xl"
      borderWidth="1"
      borderStyle="solid"
      borderColor="border"
    >
      <ChatTranscript
        className={cx(sx({ position: 'absolute', inset: '0' }))}
        stickToBottom
        pinUserMessages
        mentionProvider={chatMentionProvider}
        padTop={PAD_TOP}
        padBottom={composerH + PAD_BOTTOM_MARGIN}
        onReady={handleReady}
        onAtBottomChange={setAtBottom}
        commands={commands}
      />

      <div
        ref={composerRef}
        className={cx(
          s.bgSurface80,
          s.backdropBlurSm,
          s.mxAuto,
          s.maxW2xl,
          sx({
            position: 'absolute',
            left: '0',
            right: '0',
            bottom: '0',
            width: 'full',
            paddingBottom: '2',
          })
        )}
      >
        {!atBottom && (
          <div
            className={cx(
              s.negTop2,
              s.left50pct,
              s.negTranslateX,
              s.negTranslateY,
              sx({ position: 'absolute' })
            )}
          >
            <Button
              variant="primary"
              size="sm"
              icon
              aria-label="Scroll to bottom"
              onClick={() => handleRef.current?.scrollToBottom({ behavior: 'smooth' })}
              className={cx(sx({ rounded: 'full' }), s.shadowMd)}
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
          permissionRequest={permissionRequest}
          permissionQueueCount={permissionQueueCount}
          onResolvePermission={(optionId) => {
            console.log('Permission resolved:', optionId);
          }}
          onViewImage={(att) => setViewer({ src: att.previewUrl, alt: att.name })}
        />
      </div>
      <ImageViewerDialog
        open={!!viewer}
        onOpenChange={(o) => !o && setViewer(null)}
        src={viewer?.src}
        alt={viewer?.alt}
      />
    </Box>
  );
}

const meta: Meta = {
  title: 'Examples/ChatPanel',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Live: Story = {
  render: () => (
    <Box display="flex" className={s.hScreen} alignItems="stretch" padding="6">
      <Box flex="1">
        <LiveChatPanel />
      </Box>
    </Box>
  ),
};

export const MaxTurnRequests: Story = {
  render: () => (
    <Box display="flex" className={s.hScreen} alignItems="stretch" padding="6">
      <Box flex="1">
        <LiveChatPanel notice={stopReasonNotice('max_turn_requests')} />
      </Box>
    </Box>
  ),
};

export const Refusal: Story = {
  render: () => (
    <Box display="flex" className={s.hScreen} alignItems="stretch" padding="6">
      <Box flex="1">
        <LiveChatPanel notice={stopReasonNotice('refusal')} />
      </Box>
    </Box>
  ),
};

export const MaxTokens: Story = {
  render: () => (
    <Box display="flex" className={s.hScreen} alignItems="stretch" padding="6">
      <Box flex="1">
        <LiveChatPanel notice={stopReasonNotice('max_tokens')} />
      </Box>
    </Box>
  ),
};

const MOCK_PERMISSION: ComposerPermissionRequest = {
  requestId: 'req-1',
  title: 'Read a File',
  options: [
    { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'allow-always', name: 'Allow always', kind: 'allow_always' },
    { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
    { optionId: 'reject-always', name: 'Reject always', kind: 'reject_always' },
  ],
};

export const PermissionSingle: Story = {
  render: () => (
    <Box display="flex" className={s.hScreen} alignItems="stretch" padding="6">
      <Box flex="1">
        <LiveChatPanel permissionRequest={MOCK_PERMISSION} permissionQueueCount={1} />
      </Box>
    </Box>
  ),
};

export const PermissionQueued: Story = {
  render: () => (
    <Box display="flex" className={s.hScreen} alignItems="stretch" padding="6">
      <Box flex="1">
        <LiveChatPanel permissionRequest={MOCK_PERMISSION} permissionQueueCount={2} />
      </Box>
    </Box>
  ),
};

export const PermissionExecute: Story = {
  render: () => (
    <Box display="flex" className={s.hScreen} alignItems="stretch" padding="6">
      <Box flex="1">
        <LiveChatPanel
          permissionRequest={{
            requestId: 'req-exec',
            title: 'Execute',
            options: [
              { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
              { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
            ],
          }}
          permissionQueueCount={1}
        />
      </Box>
    </Box>
  ),
};
