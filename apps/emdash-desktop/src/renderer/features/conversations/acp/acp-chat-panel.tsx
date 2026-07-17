import type { AttachmentMimeType, AttachmentRef } from '@emdash/core/acp/client';
import { ChatComposer, ImageViewerDialog, MermaidViewerDialog } from '@emdash/ui/react/components';
import type {
  CommandItem,
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
import { conversationRegistry } from '@renderer/features/conversations/stores/conversation-registry';
import { IntegrationIcon } from '@renderer/features/integrations/integration-icon';
import { useConnectedIssueProviders } from '@renderer/features/integrations/use-connected-issue-providers';
import { usePromptLibrary } from '@renderer/features/library/prompts/use-prompt-library';
import {
  asMounted,
  getProjectStore,
  getProjectViewStore,
} from '@renderer/features/projects/stores/project-selectors';
import { usePaneContext } from '@renderer/features/tabs/pane-context';
// TODO(conversations-extraction): Inject task editor/file-opening behavior into ACP chat.
import {
  openFileInAdjacentPane,
  openFileInTaskEditor,
} from '@renderer/features/tasks/stores/open-file-in-file-editor';
// TODO(conversations-extraction): Pass task state into ACP chat instead of importing task stores.
import {
  asProvisioned,
  getRegisteredTaskData,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
import {
  issueMentionToken,
  parseIssueMentionToken,
} from '@renderer/lib/chat/chat-mention-provider';
import { ChatTranscript } from '@renderer/lib/chat/chat-transcript';
import type { ChatCommands, ChatView } from '@renderer/lib/chat/chat-transcript';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { isHeicLikeFile, isUnstableDropPath } from '@renderer/lib/pty/terminal-image-paths';
import { useAgents } from '@renderer/lib/stores/use-agents';
import { Button } from '@renderer/lib/ui/button';
import { log } from '@renderer/utils/logger';
import { linkedIssueMentionName, type LinkedIssue } from '@shared/core/linked-issue';
import type { AcpChatStore, AcpPromptAttachment } from './acp-chat-store';
import type { AcpChatTabResource } from './acp-chat-tab-resource';
import { chatViewCommandForShortcut, executeChatViewCommand } from './acp-chat-view-commands';
import { buildIssueMentionHiddenContext } from './issue-mention-context';

// ── Helpers ───────────────────────────────────────────────────────────────────

const attachmentDataUrlCache = new Map<string, Promise<string | null>>();
const ISSUE_SEARCH_MIN_LENGTH = 2;
const ISSUE_SEARCH_LIMIT = 20;
const SLASH_COMMANDS_SECTION = 'Commands';
const SLASH_PROMPTS_SECTION = 'Prompts';

function promptPreview(text: string): string {
  return text.split(/\r?\n/, 1)[0] ?? '';
}

function commandMatchesQuery(command: CommandItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [command.name, command.label, command.description]
    .filter((value): value is string => !!value)
    .some((value) => value.toLowerCase().includes(normalized));
}

function toIssueMentionItem(issue: LinkedIssue): MentionItem {
  const token = issueMentionToken(issue.provider, issue.identifier);
  return {
    id: token,
    label: token,
    name: linkedIssueMentionName(issue),
    kind: 'issue',
    description: issue.title,
    icon: <IntegrationIcon provider={issue.provider} size={13} />,
  };
}

function issueMatchesQuery(issue: LinkedIssue, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [issue.identifier, issue.displayIdentifier, issue.title]
    .filter((value): value is string => !!value)
    .some((value) => value.toLowerCase().includes(normalized));
}

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

const supportedAttachmentMimeTypes = new Set<AttachmentMimeType>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);
const attachmentMimeTypeByExtension: Record<string, AttachmentMimeType> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function toAttachmentMimeTypeValue(value: string): AttachmentMimeType | null {
  const mimeType = value.toLowerCase();
  return supportedAttachmentMimeTypes.has(mimeType as AttachmentMimeType)
    ? (mimeType as AttachmentMimeType)
    : null;
}

function toAttachmentMimeType(file: File): AttachmentMimeType | null {
  const declaredMimeType = toAttachmentMimeTypeValue(file.type);
  if (declaredMimeType) return declaredMimeType;
  const extension = file.name.split('.').pop()?.toLowerCase();
  return extension ? (attachmentMimeTypeByExtension[extension] ?? null) : null;
}

function readFileAsDataUrl(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined);
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(file);
  });
}

async function uploadImageFile(
  store: AcpChatStore,
  file: File
): Promise<ComposerAttachment | null> {
  const mimeType = toAttachmentMimeType(file);
  if (!mimeType) {
    log.warn('Dropped image type is not supported for ACP attachments', {
      name: file.name,
      type: file.type,
    });
    return null;
  }

  const originalPath = window.electronAPI.getPathForFile(file).trim();
  const canReference =
    originalPath.length > 0 && !isUnstableDropPath(originalPath) && !isHeicLikeFile(file);
  const previewUrl = await readFileAsDataUrl(file);
  let ref: AttachmentRef | null;
  try {
    ref = canReference
      ? await store.uploadAttachment({ originalPath, mimeType, name: file.name })
      : await store.uploadAttachment({
          source: file.stream(),
          size: file.size,
          mimeType,
          name: file.name,
        });
  } catch (error) {
    log.warn('Failed to prepare ACP attachment upload', { name: file.name, error });
    return null;
  }

  if (!ref) return null;
  return {
    id: ref.id,
    name: ref.name,
    kind: 'image',
    previewUrl,
    mimeType: ref.mimeType,
  };
}

function resolveAttachmentDataUrl(store: AcpChatStore, id: string): Promise<string | null> {
  if (!store.session) return Promise.resolve(null);
  const cached = attachmentDataUrlCache.get(id);
  if (cached) return cached;
  const promise = store.session
    .downloadAttachment(id)
    .then((result) => {
      if (!result.success) return null;
      return `data:${result.data.ref.mimeType};base64,${bytesToBase64(result.data.data)}`;
    })
    .catch((error: unknown) => {
      log.warn('Failed to resolve ACP attachment', { id, error });
      return null;
    });
  attachmentDataUrlCache.set(id, promise);
  return promise;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
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
  const promptPreparationRef = useRef(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const { value: promptLibrary } = usePromptLibrary();

  const replaceAttachments = useCallback((next: ComposerAttachment[]) => {
    attachmentsRef.current = next;
    setAttachments(next);
  }, []);

  // Autofocus when the slot becomes available.
  useEffect(() => {
    editorApiRef.current?.focus();
  }, []);

  useEffect(() => {
    const editor = editorApiRef.current;
    if (!editor || editor.getText() === store.draftText) return;
    editor.setText(store.draftText);
  }, [store, store.draftText]);

  const buildPromptAttachments = useCallback(
    (): AcpPromptAttachment[] =>
      attachmentsRef.current
        .filter((att) => att.kind === 'image' && toAttachmentMimeTypeValue(att.mimeType ?? ''))
        .map((att) => {
          const mimeType = toAttachmentMimeTypeValue(att.mimeType ?? '') ?? 'image/png';
          return {
            ref: {
              type: 'attachment' as const,
              id: att.id,
              mimeType,
              name: att.name,
            },
            previewUrl: att.previewUrl,
          };
        }),
    []
  );

  const buildHiddenIssueContext = useCallback(
    (value: string) =>
      buildIssueMentionHiddenContext(value, async (target) => {
        const result = await rpc.issues.getIssueContext(target.provider, {
          identifier: target.identifier,
          projectId: store.projectId,
        });
        if (!result.success) {
          log.warn('Failed to resolve issue mention context', {
            token: target.token,
            error: result.error,
          });
          return null;
        }
        return result.data;
      }),
    [store.projectId]
  );

  const sendPreparedPrompt = useCallback(
    async (value: string, queued: boolean) => {
      if (promptPreparationRef.current) return;
      const requestedAttachments = buildPromptAttachments();
      if (!value.trim() && requestedAttachments.length === 0) return;

      promptPreparationRef.current = true;
      try {
        const hiddenContext = await buildHiddenIssueContext(value);
        const currentAttachmentIds = new Set(
          buildPromptAttachments().map((attachment) => attachment.ref.id)
        );
        const promptAttachments = requestedAttachments.filter((attachment) =>
          currentAttachmentIds.has(attachment.ref.id)
        );
        if (!value.trim() && promptAttachments.length === 0) return;
        const accepted = queued
          ? store.queuePrompt(value, promptAttachments, hiddenContext)
          : store.submitPrompt(value, promptAttachments, hiddenContext);
        if (!accepted) return;

        const submittedAttachmentIds = new Set(
          promptAttachments.map((attachment) => attachment.ref.id)
        );
        if (submittedAttachmentIds.size > 0) {
          replaceAttachments(
            attachmentsRef.current.filter(
              (attachment) => !submittedAttachmentIds.has(attachment.id)
            )
          );
        }
        const editor = editorApiRef.current;
        if (editor?.getText() === value) editor.clear();
      } finally {
        promptPreparationRef.current = false;
      }
    },
    [store, buildPromptAttachments, buildHiddenIssueContext, replaceAttachments]
  );

  const handleSubmit = useCallback(
    (value: string) => sendPreparedPrompt(value, false),
    [sendPreparedPrompt]
  );

  const handleSubmitWhileWorking = useCallback(
    (value: string) => sendPreparedPrompt(value, true),
    [sendPreparedPrompt]
  );

  const handleStop = useCallback(() => {
    store.stop();
  }, [store]);

  const handleResolvePermission = useCallback(
    (optionId: string | null) => {
      if (!optionId) return;
      store.resolvePermission(optionId);
    },
    [store]
  );

  const handleSendQueuedPromptNow = useCallback(
    (id: string) => {
      if (!store.affordances.isWorking) {
        store.sendQueuedPromptNow(id);
        return;
      }
      showModal('confirmActionModal', {
        title: 'Turn in progress',
        description: 'Send this queued prompt now and cancel the active turn?',
        confirmLabel: 'Cancel & Send',
        variant: 'destructive',
        onSuccess: () => {
          store.sendQueuedPromptNow(id);
        },
      });
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

  const addImageFiles = useCallback(
    async (files: File[]) => {
      const supportedFiles = files.filter((file) => toAttachmentMimeType(file) !== null);
      if (supportedFiles.length < files.length) {
        const unsupportedNames = files
          .filter((file) => toAttachmentMimeType(file) === null)
          .map((file) => file.name || 'unnamed image')
          .join(', ');
        toast({
          title: 'Unsupported image format',
          description: `${unsupportedNames} could not be attached. Use PNG, JPEG, GIF, or WebP.`,
          variant: 'destructive',
        });
      }

      const next = await Promise.all(supportedFiles.map((file) => uploadImageFile(store, file)));
      const uploaded = next.filter((att): att is ComposerAttachment => att !== null);
      if (uploaded.length > 0) {
        replaceAttachments([...attachmentsRef.current, ...uploaded]);
      }
    },
    [store, replaceAttachments]
  );

  const handleAttachmentsChange = useCallback(
    (next: ComposerAttachment[]) => {
      const nextIds = new Set(next.map((attachment) => attachment.id));
      for (const attachment of attachmentsRef.current) {
        if (attachment.kind === 'image' && !nextIds.has(attachment.id)) {
          void store.deleteAttachment(attachment.id);
        }
      }
      replaceAttachments(next);
    },
    [store, replaceAttachments]
  );

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = '';
      if (files.length === 0) return;

      const images = files.filter((f) => f.type.startsWith('image/'));
      if (images.length > 0) {
        await addImageFiles(images);
      }

      insertFileMentions(files);
    },
    [addImageFiles, insertFileMentions]
  );

  const workspaceId = useObserver(
    () => asProvisioned(getTaskStore(store.projectId, store.taskId))?.workspaceId
  );
  const linkedIssue = useObserver(
    () => getRegisteredTaskData(store.projectId, store.taskId)?.linkedIssue
  );
  const issueProviderContext = useObserver(() => {
    const mounted = asMounted(getProjectStore(store.projectId));
    return {
      projectPath: mounted?.data.path,
      repositoryUrl:
        mounted?.gitRepository.issueRepositoryUrl ??
        mounted?.gitRepository.canonicalRepositoryUrl ??
        undefined,
      selectedIssueProvider: getProjectViewStore(store.projectId)?.selectedIssueProvider ?? null,
    };
  });
  const { connectedProviders, isProviderUsable } = useConnectedIssueProviders(issueProviderContext);
  const issueProvider = useMemo(() => {
    const selected = issueProviderContext.selectedIssueProvider;
    if (selected && isProviderUsable(selected)) return selected;
    return connectedProviders[0] ?? null;
  }, [connectedProviders, isProviderUsable, issueProviderContext.selectedIssueProvider]);

  const mentionProvider = useMemo<ContextMentionProvider | undefined>(() => {
    if (!workspaceId && !linkedIssue && !issueProvider) return undefined;
    const wsId = workspaceId;
    return {
      async search(query: string): Promise<MentionItem[]> {
        const pinnedIssue =
          linkedIssue && issueMatchesQuery(linkedIssue, query)
            ? toIssueMentionItem(linkedIssue)
            : null;
        const issueSearch =
          issueProvider && query.trim().length >= ISSUE_SEARCH_MIN_LENGTH
            ? rpc.issues
                .searchIssues(issueProvider, {
                  limit: ISSUE_SEARCH_LIMIT,
                  searchTerm: query.trim(),
                  projectId: store.projectId,
                  projectPath: issueProviderContext.projectPath,
                  repositoryUrl: issueProviderContext.repositoryUrl ?? undefined,
                })
                .catch((error: unknown) => {
                  log.warn('Failed to search issue mentions', { provider: issueProvider, error });
                  return null;
                })
            : Promise.resolve(null);

        const [files, issueResult] = await Promise.all([
          wsId
            ? rpc.search.searchWorkspaceFiles({ workspaceId: wsId, query })
            : Promise.resolve([]),
          issueSearch,
        ]);

        const pinnedIssueItems: MentionItem[] = [];
        const searchedIssueItems: MentionItem[] = [];
        const seenIssueIds = new Set<string>();
        if (pinnedIssue) {
          pinnedIssueItems.push(pinnedIssue);
          seenIssueIds.add(pinnedIssue.id);
        }
        if (issueResult?.success) {
          for (const issue of issueResult.data) {
            const item = toIssueMentionItem(issue);
            if (seenIssueIds.has(item.id)) continue;
            seenIssueIds.add(item.id);
            searchedIssueItems.push(item);
          }
        } else if (issueResult && !issueResult.success) {
          log.warn('Failed to search issue mentions', {
            provider: issueProvider,
            error: issueResult.error,
          });
        }

        const fileItems = files.map((f) => ({
          id: f.path,
          label: f.path,
          name: f.filename,
          kind: 'file' as const,
          description: f.path,
        }));

        return [...pinnedIssueItems, ...fileItems, ...searchedIssueItems];
      },
    };
  }, [
    workspaceId,
    linkedIssue,
    issueProvider,
    store.projectId,
    issueProviderContext.projectPath,
    issueProviderContext.repositoryUrl,
  ]);

  const { data: agents } = useAgents();
  const agentOptions = useMemo<ComposerAgentOption[]>(
    () =>
      (agents ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        icon: <AgentIcon id={a.id} size={14} className="rounded-sm" />,
      })),
    [agents]
  );

  const providerId =
    conversationRegistry.get(store.taskId)?.conversations.get(store.conversationId)?.data
      .providerId ?? null;
  const renderMentionIcon = useCallback(({ id, kind }: { id: string; kind: string }) => {
    if (kind !== 'issue') return null;
    const target = parseIssueMentionToken(id);
    if (!target) return null;
    return <IntegrationIcon provider={target.provider} size={12} />;
  }, []);

  const querySlashItems = useCallback(
    async (query: string): Promise<CommandItem[]> => {
      const normalized = query.trim().toLowerCase();
      const commands = store.commands
        .filter((command) => commandMatchesQuery(command, normalized))
        .map((command) => ({
          ...command,
          section: SLASH_COMMANDS_SECTION,
        }));
      const prompts = promptLibrary
        .filter((prompt) => {
          if (!normalized) return true;
          return [prompt.title, prompt.prompt].some((value) =>
            value.toLowerCase().includes(normalized)
          );
        })
        .map((prompt) => ({
          id: `prompt:${prompt.id}`,
          name: prompt.title,
          label: prompt.title,
          description: promptPreview(prompt.prompt),
          behavior: 'insert-text' as const,
          insertText: prompt.prompt,
          section: SLASH_PROMPTS_SECTION,
        }));
      return [...commands, ...prompts];
    },
    [store, promptLibrary]
  );

  const a = store.affordances;
  const permissionRequest = toComposerPermission(store.permissionQueue[0]);

  return createPortal(
    <>
      <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileInputChange} />
      <ChatComposer
        isWorking={a.isWorking}
        canSubmit={a.canSubmit}
        onSubmit={handleSubmit}
        onInputChange={(text) => store.setDraftText(text)}
        onSubmitWhileWorking={handleSubmitWhileWorking}
        onStop={a.isWorking ? handleStop : undefined}
        permissionRequest={permissionRequest}
        permissionQueueCount={store.permissionQueue.length}
        onResolvePermission={handleResolvePermission}
        queuedPrompts={store.queuedPrompts}
        onEditQueuedPrompt={(id, text) => store.editQueuedPrompt(id, text)}
        onDeleteQueuedPrompt={(id) => store.deleteQueuedPrompt(id)}
        onReorderQueuedPrompts={(ids) => store.reorderQueuedPrompts(ids)}
        onSendQueuedPromptNow={handleSendQueuedPromptNow}
        editorApiRef={editorApiRef}
        modelOptions={store.modelOptions}
        selectedModel={store.model ?? undefined}
        isModelChanging={store.isModelChanging}
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
        renderMentionIcon={renderMentionIcon}
        queryCommands={querySlashItems}
        attachments={attachments}
        onAttachmentsChange={handleAttachmentsChange}
        onAttach={handleAttach}
        onImageFilesDropped={(files) => void addImageFiles(files)}
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

  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<ChatView | null>(null);
  const [composerSlot, setComposerSlot] = useState<HTMLElement | null>(null);
  const [heroSlot, setHeroSlot] = useState<HTMLElement | null>(null);
  const [overlaySlot, setOverlaySlot] = useState<HTMLElement | null>(null);
  const [viewer, setViewer] = useState<{ src?: string; alt?: string } | null>(null);
  const [mermaidViewer, setMermaidViewer] = useState<{ svg: string | null } | null>(null);
  const placementConversationRef = useRef<string | null>(null);
  const placementWasEmptyRef = useRef<boolean | null>(null);
  // True while the scroll viewport is at the tail. Defaults to true so the
  // button does not flash on mount before the first frame fires.
  const [atBottom, setAtBottom] = useState(true);

  const handleReady = useCallback((view: ChatView) => {
    viewRef.current = view;
    setComposerSlot(view.composerSlot);
    setHeroSlot(view.heroSlot);
    setOverlaySlot(view.contentOverlay);
  }, []);

  const isConversationEmpty = useObserver(() => store?.isEmpty ?? false);
  const activeConversationId = store?.conversationId ?? null;

  useEffect(() => {
    if (!store || !viewRef.current) return;
    const sameConversation = placementConversationRef.current === store.conversationId;
    const wasEmpty = placementWasEmptyRef.current === true;
    const placement = isConversationEmpty ? 'center' : 'bottom';
    viewRef.current.setComposerPlacement(placement, {
      animate: sameConversation && wasEmpty && !isConversationEmpty,
    });
    placementConversationRef.current = store.conversationId;
    placementWasEmptyRef.current = isConversationEmpty;
  }, [store, activeConversationId, isConversationEmpty, composerSlot]);

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
  const { data: agents } = useAgents();
  const providerId = conversationStore?.data.providerId ?? null;
  const agent = agents?.find((candidate) => candidate.id === providerId) ?? null;
  const cliAuthMethod =
    agent?.capabilities.auth.kind === 'supported'
      ? agent.capabilities.auth.methods.find((method) => method.kind === 'cli-login')
      : undefined;

  const openSignInModal = useCallback(() => {
    if (!providerId || !cliAuthMethod || !store) return;
    showModal('agentSignInModal', {
      providerId,
      methodId: cliAuthMethod.id,
      providerName: agent?.name ?? providerId,
      onSuccess: () => {
        if (store.loadError?.kind === 'auth_required') store.retry();
      },
    });
  }, [agent?.name, cliAuthMethod, providerId, store]);

  useEffect(() => {
    if (conversationStore && !conversationStore.seen) {
      conversationStore.markSeen();
    }
  }, [conversationStore, conversationSeen]);

  useEffect(() => {
    if (!store) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root || !eventComposedPathContains(event, root)) return;

      const commandId = chatViewCommandForShortcut(event);
      if (!commandId) return;
      if (!executeChatViewCommand(viewRef.current, commandId)) return;

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [store]);

  const handleViewerOpen = useCallback((src?: string, alt?: string) => {
    setViewer({ src, alt });
  }, []);

  const transcriptCommands = useMemo<ChatCommands>(
    () => ({
      onViewImage: (arg) => {
        if (arg.attachment.dataUrl || !store) {
          handleViewerOpen(arg.attachment.dataUrl, arg.attachment.name);
          return;
        }
        void resolveAttachmentDataUrl(store, arg.attachment.id).then((src) =>
          handleViewerOpen(src ?? undefined, arg.attachment.name)
        );
      },
      resolveAttachment: (attachment) =>
        store ? resolveAttachmentDataUrl(store, attachment.id) : Promise.resolve(null),
      onViewMermaid: (arg) => {
        setMermaidViewer({
          svg: store?.chatContext.sharedCaches.renderMermaid(arg.chart) ?? null,
        });
      },
      onOpenFile: (arg) => {
        if (!store) return;
        const open = arg.source === 'diff' ? openFileInAdjacentPane : openFileInTaskEditor;
        void open(store.projectId, store.taskId, arg.path);
      },
      onClickMention: (arg: Parameters<NonNullable<ChatCommands['onClickMention']>>[0]) => {
        if (!store) return;
        if (arg.kind === 'file') {
          void openFileInTaskEditor(store.projectId, store.taskId, arg.id);
          return;
        }
        if (arg.kind === 'issue') {
          const target = parseIssueMentionToken(arg.id);
          if (!target) return;
          void rpc.issues
            .getIssueContext(target.provider, {
              identifier: target.identifier,
              projectId: store.projectId,
            })
            .then((result) => {
              if (result.success && result.data.url) {
                void rpc.app.openExternal(result.data.url);
              }
            });
        }
      },
    }),
    [store, handleViewerOpen]
  );

  if (!store) return null;

  const showComposer = !store.historyLoading && store.loadError === null;
  const showHero = showComposer && store.isEmpty;

  return (
    <div ref={rootRef} className="relative h-full overflow-hidden bg-background-secondary-1">
      <ChatTranscript
        context={store.chatContext}
        state={store.chatState}
        composer="slot"
        composerPlacement={store.isEmpty ? 'center' : 'bottom'}
        contentOverlay
        stickToBottom
        pinUserMessages
        onReady={handleReady}
        commands={transcriptCommands}
        onAtBottomChange={setAtBottom}
        style={{ position: 'absolute', inset: 0 }}
      />

      {/* Loading / error overlay portaled into the library-owned slot.
          The slot sits at z-index 15 (above pinned, below composer at 20).
          Hide the composer in error state so the overlay owns the whole content area.
          Precedence: error > loading. */}
      {overlaySlot &&
        (store.loadError !== null || store.historyLoading) &&
        createPortal(
          <div
            // The library-owned overlay slot is pointer-events: none by design;
            // opt back in so the Sign in / Retry buttons are clickable.
            className={`pointer-events-auto absolute inset-0 flex items-center justify-center text-sm text-foreground-muted ${
              store.loadError !== null || store.historyLoading ? 'bg-background-secondary-1' : ''
            }`}
            aria-live="polite"
          >
            {store.loadError !== null ? (
              store.loadError.kind === 'auth_required' ? (
                <div className="flex max-w-md flex-col items-center gap-2 px-6 text-center">
                  <span className="text-foreground">
                    {agent?.name ?? 'This agent'} needs you to sign in.
                  </span>
                  <span className="text-xs text-foreground-muted">
                    {cliAuthMethod?.description ?? store.loadError.message}
                  </span>
                  <div className="mt-1 flex gap-2">
                    {cliAuthMethod && (
                      <Button variant="default" size="sm" onClick={openSignInModal}>
                        Sign in
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => store.retry()}>
                      Retry
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex max-w-md flex-col items-center gap-2 px-6 text-center">
                  <span className="text-foreground">Failed to load chat.</span>
                  <span className="text-xs text-foreground-muted">{store.loadError.message}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-1"
                    onClick={() => store.retry()}
                  >
                    Retry
                  </Button>
                </div>
              )
            ) : (
              'Loading chat...'
            )}
          </div>,
          overlaySlot
        )}

      {showHero &&
        heroSlot &&
        createPortal(
          <div className="px-4 text-center">
            <h1 className="text-2xl tracking-tight text-foreground">What are we building today?</h1>
          </div>,
          heroSlot
        )}

      {showComposer && composerSlot && (
        <ComposerForStore
          key={store.conversationId}
          store={store}
          composerSlot={composerSlot}
          onViewerOpen={handleViewerOpen}
        />
      )}

      {showComposer &&
        composerSlot &&
        !atBottom &&
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
      <MermaidViewerDialog
        open={!!mermaidViewer}
        onOpenChange={(open) => {
          if (!open) setMermaidViewer(null);
        }}
        svg={mermaidViewer?.svg ?? null}
      />
    </div>
  );
});

function eventComposedPathContains(event: Event, element: HTMLElement): boolean {
  if (event.composedPath().includes(element)) return true;
  return event.target instanceof Node && element.contains(event.target);
}
