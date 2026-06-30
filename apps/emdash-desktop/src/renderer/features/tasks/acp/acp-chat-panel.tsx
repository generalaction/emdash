import { ChatComposer, ImageViewerDialog } from '@emdash/ui/react/components';
import type {
  ComposerAgentOption,
  ComposerAttachment,
  ComposerPermissionRequest,
  PromptEditorRef,
} from '@emdash/ui/react/components';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePaneContext } from '@renderer/features/tabs/pane-context';
import { conversationRegistry } from '@renderer/features/tasks/stores/conversation-registry';
import { ChatTranscript } from '@renderer/lib/chat/chat-transcript';
import type { ChatView } from '@renderer/lib/chat/chat-transcript';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { useAgents } from '@renderer/lib/stores/use-agents';
import type { AcpChatStore } from './acp-chat-store';
import type { AcpChatTabResource } from './acp-chat-tab-resource';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Map an AcpPermissionRequest to the ComposerPermissionRequest shape the UI expects. */
function toComposerPermission(
  req: AcpChatStore['permissionQueue'][number] | undefined
): ComposerPermissionRequest | null {
  if (!req) return null;
  return {
    requestId: req.requestId,
    title: req.title,
    options: req.options.map((o) => ({
      optionId: o.optionId,
      name: o.name,
      kind: o.kind,
    })),
  };
}

function readImageFile(file: File): Promise<ComposerAttachment> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        id: crypto.randomUUID(),
        name: file.name,
        kind: 'image',
        previewUrl: typeof reader.result === 'string' ? reader.result : undefined,
        mimeType: file.type,
      });
    reader.onerror = () =>
      resolve({ id: crypto.randomUUID(), name: file.name, kind: 'image', mimeType: file.type });
    reader.readAsDataURL(file);
  });
}

// ── Composer for a single store ────────────────────────────────────────────────
//
// Keyed by conversationId in the parent so that drafts, focus, and editor state
// reset when switching conversations — the same isolation the old remount gave.

const ComposerForStore = observer(function ComposerForStore({
  store,
  composerSlot,
  onViewerOpen,
}: {
  store: AcpChatStore;
  composerSlot: HTMLElement;
  onViewerOpen: (src?: string, alt?: string) => void;
}) {
  const editorApiRef = useRef<PromptEditorRef | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);

  // Autofocus when the slot becomes available.
  useEffect(() => {
    editorApiRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(
    (value: string) => {
      const images = attachments
        .filter((att) => att.kind === 'image' && att.previewUrl)
        .map((att) => {
          const url = att.previewUrl!;
          return { data: url.slice(url.indexOf(',') + 1), mimeType: att.mimeType ?? 'image/png' };
        });
      if (!value.trim() && images.length === 0) return;
      store.submitPrompt(value, images);
      setAttachments([]);
    },
    [store, attachments]
  );

  const handleStop = useCallback(() => {
    store.stop();
  }, [store]);

  const handleResolvePermission = useCallback(
    (optionId: string | null) => {
      store.resolvePermission(optionId);
    },
    [store]
  );

  const handleModelChange = useCallback(
    (modelId: string) => {
      store.setModel(modelId);
    },
    [store]
  );

  const handleAttach = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'));
      e.target.value = '';
      if (files.length === 0) return;
      const next = await Promise.all(files.map(readImageFile));
      setAttachments((prev) => [...prev, ...next]);
    },
    []
  );

  const { data: agents } = useAgents();
  const agentOptions = useMemo<ComposerAgentOption[]>(
    () =>
      (agents ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        icon: <AgentIcon id={a.id} size={16} className="rounded-sm" />,
      })),
    [agents]
  );

  const providerId =
    conversationRegistry.get(store.taskId)?.conversations.get(store.conversationId)?.data
      .providerId ?? null;

  const a = store.affordances;
  const permissionRequest = toComposerPermission(store.permissionQueue[0]);

  return createPortal(
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={handleFileInputChange}
      />
      <ChatComposer
        isWorking={a.isWorking}
        canSubmit={a.canSubmit}
        onSubmit={handleSubmit}
        onStop={a.isWorking ? handleStop : undefined}
        permissionRequest={permissionRequest}
        permissionQueueCount={store.permissionQueue.length}
        onResolvePermission={handleResolvePermission}
        editorApiRef={editorApiRef}
        modelOptions={store.modelOptions}
        selectedModel={store.model ?? undefined}
        onModelChange={handleModelChange}
        agentOptions={agentOptions}
        selectedAgent={providerId ?? undefined}
        agentLocked
        onAgentChange={() => {}}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        onAttach={handleAttach}
        onViewImage={(att) => onViewerOpen(att.previewUrl, att.name)}
      />
    </>,
    composerSlot
  );
});

// ── AcpChatPanel ──────────────────────────────────────────────────────────────
//
// One persistent ChatTranscript is mounted for the lifetime of this panel.
// When the active conversation changes, props.state identity changes, which
// triggers ChatTranscript's setModel effect — the Solid view swaps ChatState
// in-place without dispose/recreate, preserving per-conversation scroll.
//
// The composer subtree is keyed by conversationId so draft text, focus, and
// editor state reset on each switch (equivalent to the old remount behavior).

export const AcpChatPanel = observer(function AcpChatPanel() {
  const { pane } = usePaneContext();

  const activeTab = pane.resolvedTabs.find((t) => t.isActive && t.kind === 'acp-chat');
  const store = activeTab ? (activeTab.resource as AcpChatTabResource).store : null;

  const viewRef = useRef<ChatView | null>(null);
  const [composerSlot, setComposerSlot] = useState<HTMLElement | null>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const [viewer, setViewer] = useState<{ src?: string; alt?: string } | null>(null);

  const handleReady = useCallback((view: ChatView) => {
    viewRef.current = view;
    setComposerSlot(view.composerSlot);
  }, []);

  // Bind/unbind the view handle to the active store so the store can call
  // scrollToItem on submit. Only the active store holds the handle.
  useEffect(() => {
    if (!store) return;
    store.bindView(viewRef.current);
    return () => {
      store.bindView(null);
    };
  }, [store]);

  // Measure composer height so the loading overlay doesn't cover the composer.
  useEffect(() => {
    if (!composerSlot) return;
    const update = () => setComposerHeight(composerSlot.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(composerSlot);
    return () => ro.disconnect();
  }, [composerSlot]);

  const handleViewerOpen = useCallback((src?: string, alt?: string) => {
    setViewer({ src, alt });
  }, []);

  if (!store) return null;

  return (
    <div
      className="relative h-full overflow-hidden"
      style={{ backgroundColor: 'var(--background)' }}
    >
      <ChatTranscript
        context={store.chatContext}
        state={store.chatState}
        composer="slot"
        stickToBottom
        pinUserMessages
        onReady={handleReady}
        style={{ position: 'absolute', inset: 0 }}
      />

      {/* Loading / empty state overlay.
          During loading: opaque background covers the transcript but stops above
          the composer (bottom inset = composerHeight).
          During empty: transparent so the composer is visible below. */}
      {(store.historyLoading || store.isEmpty) && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-foreground-muted"
          style={{
            bottom: composerHeight,
            ...(store.historyLoading ? { backgroundColor: 'var(--background)' } : null),
          }}
          aria-live="polite"
        >
          {store.historyLoading ? 'Loading chat...' : 'No messages'}
        </div>
      )}

      {composerSlot && (
        <ComposerForStore
          key={store.conversationId}
          store={store}
          composerSlot={composerSlot}
          onViewerOpen={handleViewerOpen}
        />
      )}

      <ImageViewerDialog
        open={!!viewer}
        onOpenChange={(open) => {
          if (!open) setViewer(null);
        }}
        src={viewer?.src}
        alt={viewer?.alt}
      />
    </div>
  );
});
