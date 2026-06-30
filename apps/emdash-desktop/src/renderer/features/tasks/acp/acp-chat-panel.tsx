import { ChatComposer, ImageViewerDialog } from '@emdash/ui/react/components';
import type {
  ComposerAgentOption,
  ComposerAttachment,
  ComposerPermissionRequest,
  ContextMentionProvider,
  MentionItem,
  PromptEditorRef,
} from '@emdash/ui/react/components';
import { ArrowDown } from 'lucide-react';
import { observer, useObserver } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePaneContext } from '@renderer/features/tabs/pane-context';
import { conversationRegistry } from '@renderer/features/tasks/stores/conversation-registry';
import {
  openFileInAdjacentPane,
  openFileInTaskEditor,
} from '@renderer/features/tasks/stores/open-file-in-file-editor';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { ChatTranscript } from '@renderer/lib/chat/chat-transcript';
import type { ChatCommands, ChatView } from '@renderer/lib/chat/chat-transcript';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { rpc } from '@renderer/lib/ipc';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { useAgents } from '@renderer/lib/stores/use-agents';
import { Button } from '@renderer/lib/ui/button';
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

  const buildImages = useCallback(
    () =>
      attachments
        .filter((att) => att.kind === 'image' && att.previewUrl)
        .map((att) => {
          const url = att.previewUrl!;
          return {
            data: url.slice(url.indexOf(',') + 1),
            mimeType: att.mimeType ?? 'image/png',
            name: att.name,
          };
        }),
    [attachments]
  );

  const handleSubmit = useCallback(
    (value: string) => {
      const images = buildImages();
      if (!value.trim() && images.length === 0) return;
      store.submitPrompt(value, images);
      setAttachments([]);
    },
    [store, buildImages]
  );

  const handleSubmitWhileWorking = useCallback(
    (value: string) => {
      const images = buildImages();
      if (!value.trim() && images.length === 0) return;
      showModal('confirmActionModal', {
        title: 'Turn in progress',
        description:
          'An active turn is currently in progress. Do you want to send the message and cancel the active turn?',
        confirmLabel: 'Cancel & Send',
        variant: 'destructive',
        onSuccess: () => {
          store.cancelAndSubmit(value, images);
          setAttachments([]);
        },
      });
    },
    [store, buildImages]
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

  const handleModeChange = useCallback(
    (modeId: string) => {
      store.setMode(modeId);
    },
    [store]
  );

  const handleEffortChange = useCallback(
    (effortId: string) => {
      store.setEffort(effortId);
    },
    [store]
  );

  const handleAttach = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const insertFileMentions = useCallback((files: File[]) => {
    for (const file of files) {
      if (file.type.startsWith('image/')) continue;
      const abs = window.electronAPI.getPathForFile(file).trim().replace(/\\/g, '/');
      if (!abs) continue;
      const name = abs.split('/').pop() ?? abs;
      editorApiRef.current?.insertMention({ id: abs, label: abs, name, kind: 'file' });
    }
  }, []);

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = '';
      if (files.length === 0) return;

      const images = files.filter((f) => f.type.startsWith('image/'));
      if (images.length > 0) {
        const next = await Promise.all(images.map(readImageFile));
        setAttachments((prev) => [...prev, ...next]);
      }

      insertFileMentions(files);
    },
    [insertFileMentions]
  );

  const workspaceId = useObserver(
    () => asProvisioned(getTaskStore(store.projectId, store.taskId))?.workspaceId
  );

  const mentionProvider = useMemo<ContextMentionProvider | undefined>(() => {
    if (!workspaceId) return undefined;
    const wsId = workspaceId;
    return {
      async search(query: string): Promise<MentionItem[]> {
        const files = await rpc.search.searchWorkspaceFiles({ workspaceId: wsId, query });
        return files.map((f) => ({
          id: f.path,
          label: f.path,
          name: f.filename,
          kind: 'file' as const,
          description: f.path,
        }));
      },
    };
  }, [workspaceId]);

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
      <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileInputChange} />
      <ChatComposer
        isWorking={a.isWorking}
        canSubmit={a.canSubmit}
        onSubmit={handleSubmit}
        onSubmitWhileWorking={handleSubmitWhileWorking}
        onStop={a.isWorking ? handleStop : undefined}
        permissionRequest={permissionRequest}
        permissionQueueCount={store.permissionQueue.length}
        onResolvePermission={handleResolvePermission}
        editorApiRef={editorApiRef}
        modelOptions={store.modelOptions}
        selectedModel={store.model ?? undefined}
        onModelChange={handleModelChange}
        effortOptions={store.effortOptions}
        selectedEffort={store.effort ?? undefined}
        onEffortChange={handleEffortChange}
        permissionModeOptions={store.permissionModeOptions}
        selectedPermissionMode={store.permissionMode ?? undefined}
        onPermissionModeChange={handleModeChange}
        agentOptions={agentOptions}
        selectedAgent={providerId ?? undefined}
        agentLocked
        onAgentChange={() => {}}
        contextUsage={
          store.usage
            ? {
                used: store.usage.contextUsed,
                size: store.usage.contextSize,
                cost: store.usage.cost,
              }
            : null
        }
        mentionProvider={mentionProvider}
        queryCommands={async (query) =>
          store.commands.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
        }
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        onAttach={handleAttach}
        onFilesDropped={insertFileMentions}
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
  const [overlaySlot, setOverlaySlot] = useState<HTMLElement | null>(null);
  const [viewer, setViewer] = useState<{ src?: string; alt?: string } | null>(null);
  // True while the latest user message is visible in the viewport. Defaults to
  // true so the button does not flash on mount before the first frame fires.
  const [activeUserVisible, setActiveUserVisible] = useState(true);

  const handleReady = useCallback((view: ChatView) => {
    viewRef.current = view;
    setComposerSlot(view.composerSlot);
    setOverlaySlot(view.contentOverlay);
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

  // State-driven notification clearing: mark the active conversation as seen
  // immediately when the panel is showing it. This covers the split-pane case
  // where the same tab stays active and onActivate() does not re-fire.
  const conversationStore = useObserver(() =>
    store
      ? conversationRegistry.get(store.taskId)?.conversations.get(store.conversationId)
      : undefined
  );
  const conversationSeen = conversationStore?.seen;
  useEffect(() => {
    if (conversationStore && !conversationStore.seen) {
      conversationStore.markSeen();
    }
  }, [conversationStore, conversationSeen]);

  const handleViewerOpen = useCallback((src?: string, alt?: string) => {
    setViewer({ src, alt });
  }, []);

  const transcriptCommands = useMemo<ChatCommands>(
    () => ({
      onViewImage: (arg) => handleViewerOpen(arg.attachment.dataUrl, arg.attachment.name),
      onOpenFile: (arg) => {
        if (!store) return;
        const open = arg.source === 'diff' ? openFileInAdjacentPane : openFileInTaskEditor;
        void open(store.projectId, store.taskId, arg.path);
      },
      onClickMention: (arg: Parameters<NonNullable<ChatCommands['onClickMention']>>[0]) => {
        if (arg.kind !== 'file' || !store) return;
        void openFileInTaskEditor(store.projectId, store.taskId, arg.id);
      },
    }),
    [store, handleViewerOpen]
  );

  if (!store) return null;

  return (
    <div className="relative h-full overflow-hidden bg-background-secondary-1">
      <ChatTranscript
        context={store.chatContext}
        state={store.chatState}
        composer="slot"
        contentOverlay
        stickToBottom
        pinUserMessages
        onReady={handleReady}
        commands={transcriptCommands}
        onActiveUserMessageVisibilityChange={setActiveUserVisible}
        style={{ position: 'absolute', inset: 0 }}
      />

      {/* Loading / error / empty state overlay portaled into the library-owned slot.
          The slot sits at z-index 15 (above pinned, below composer at 20) so
          the composer remains visible and interactive in all states.
          During loading/error: opaque background covers the transcript area.
          During empty: transparent so the content below shows through.
          Precedence: error > loading > empty. */}
      {overlaySlot &&
        (store.loadError !== null || store.historyLoading || store.isEmpty) &&
        createPortal(
          <div
            className={`absolute inset-0 flex items-center justify-center text-sm text-foreground-muted ${
              store.loadError !== null || store.historyLoading ? 'bg-background-secondary-1' : ''
            }`}
            aria-live="polite"
          >
            {store.loadError !== null ? (
              <div className="flex flex-col items-center gap-3 px-6 text-center">
                <span>Failed to load chat.</span>
                <Button variant="outline" size="sm" onClick={() => store.retry()}>
                  Retry
                </Button>
              </div>
            ) : store.historyLoading ? (
              'Loading chat...'
            ) : (
              'No messages'
            )}
          </div>,
          overlaySlot
        )}

      {composerSlot && (
        <ComposerForStore
          key={store.conversationId}
          store={store}
          composerSlot={composerSlot}
          onViewerOpen={handleViewerOpen}
        />
      )}

      {composerSlot &&
        !activeUserVisible &&
        createPortal(
          <div className="pointer-events-none absolute inset-x-0 bottom-full mb-2 flex justify-center">
            <Button
              variant="secondary"
              size="icon-md"
              aria-label="Scroll to bottom"
              onClick={() => viewRef.current?.scrollToBottom({ behavior: 'smooth' })}
              className="pointer-events-auto rounded-full shadow-md"
            >
              <ArrowDown />
            </Button>
          </div>,
          composerSlot
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
