import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  FileIcon,
  ImageIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  SquareIcon,
  TerminalIcon,
  XIcon,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { openFileInTaskEditor } from '@renderer/features/tasks/stores/open-file-in-file-editor';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { rpc } from '@renderer/lib/ipc';
import { agentMeta } from '@renderer/lib/providers/meta';
import { resolveDroppedFile } from '@renderer/lib/pty/terminal-image-injection';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@renderer/lib/ui/alert';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Textarea } from '@renderer/lib/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { isNativeChatProvider, type NativeChatProviderId } from '@shared/conversation-ui';
import {
  CLAUDE_CHAT_MODEL_OPTIONS,
  CLAUDE_EFFORT_OPTIONS,
  CODEX_CHAT_MODEL_OPTIONS,
  CODEX_EFFORT_OPTIONS,
  PI_CHAT_MODEL_OPTIONS,
  type NativeChatOptions,
  type CodexServiceTier,
  type NativeChatAttachment,
  type NativeChatEffortOption,
  type NativeChatModelOption,
  type NativeChatReasoningEffort,
} from '@shared/native-chat';
import type { CatalogSkill } from '@shared/core/skills/types';
import {
  buildNativeChatSlashEntries,
  filterNativeChatSlashEntries,
  getNativeChatSlashTrigger,
  replaceSlashTrigger,
  type NativeChatSlashEntry,
} from './native-chat-slash-menu';
import { NativeChatStore } from './native-chat-store';
import { groupChatItems, turnKeyOf } from './native-chat-transcript';
import { ActivityGroupView, ChatItemView } from './NativeChatItemView';

const SCROLL_STICK_THRESHOLD_PX = 48;
const COLUMN = 'mx-auto w-full max-w-[44rem]';

/** Composer-local attachment: shared shape plus a preview object URL for images. */
type ComposerAttachment = NativeChatAttachment & { previewUrl?: string };

/** Per-provider option menu contents; Speed (service tier) is Codex-only. */
const PROVIDER_MENU_OPTIONS: Record<
  NativeChatProviderId,
  {
    models: NativeChatModelOption[];
    efforts: NativeChatEffortOption[];
    /** Compact form for the trigger, e.g. "GPT-5.5" -> "5.5". */
    triggerModelLabel: (label: string) => string;
    hasSpeed: boolean;
    access: { sandboxed: string; sandboxedDescription: string; fullDescription: string };
  }
> = {
  codex: {
    models: CODEX_CHAT_MODEL_OPTIONS,
    efforts: CODEX_EFFORT_OPTIONS,
    triggerModelLabel: (label) => label.replace(/^GPT-/, ''),
    hasSpeed: true,
    access: {
      sandboxed: 'Sandboxed',
      sandboxedDescription: 'Writes limited to this workspace',
      fullDescription: 'No sandbox, no approvals',
    },
  },
  claude: {
    models: CLAUDE_CHAT_MODEL_OPTIONS,
    efforts: CLAUDE_EFFORT_OPTIONS,
    triggerModelLabel: (label) => label,
    hasSpeed: false,
    access: {
      sandboxed: 'Accept edits',
      sandboxedDescription: 'Edits allowed; other tools follow permission rules',
      fullDescription: 'Skips all permission checks',
    },
  },
  pi: {
    models: PI_CHAT_MODEL_OPTIONS,
    efforts: CODEX_EFFORT_OPTIONS,
    triggerModelLabel: (label) => label,
    hasSpeed: false,
    access: {
      sandboxed: 'Standard',
      sandboxedDescription: 'Default permission behavior',
      fullDescription: 'Skips approvals',
    },
  },
};

function assertNativeChatProvider(providerId: string): asserts providerId is NativeChatProviderId {
  if (!isNativeChatProvider(providerId)) {
    throw new Error(`Native chat is not supported for provider: ${providerId}`);
  }
}

function OptionItemContent({ label, description }: { label: string; description?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
      <span>{label}</span>
      {description && (
        <span className="text-tiny leading-snug text-foreground-passive">{description}</span>
      )}
    </div>
  );
}

function menuValueLabel(value: string | undefined): string {
  return value ?? 'Default';
}

function SettingsSubTrigger({
  label,
  value,
  destructive,
}: {
  label: string;
  value: string;
  destructive?: boolean;
}) {
  return (
    <DropdownMenuSubTrigger className="h-8 px-2 py-1">
      <span className="min-w-0 flex-1 text-sm text-foreground-muted">{label}</span>
      <span
        className={cn(
          'max-w-24 truncate text-right text-xs text-foreground-passive',
          destructive && 'text-foreground-destructive'
        )}
      >
        {value}
      </span>
    </DropdownMenuSubTrigger>
  );
}

function ModelOptionsMenu({
  providerId,
  model,
  reasoningEffort,
  serviceTier,
  autoApprove,
  onChange,
}: {
  providerId: NativeChatProviderId;
  model: string | undefined;
  reasoningEffort: NativeChatReasoningEffort | undefined;
  serviceTier: CodexServiceTier | undefined;
  autoApprove: boolean | undefined;
  onChange: (options: NativeChatOptions) => void;
}) {
  const menu = PROVIDER_MENU_OPTIONS[providerId];
  // Fall back to the raw id for values persisted before the curated lists changed.
  const modelOption = model ? menu.models.find((option) => option.id === model) : undefined;
  const effortOption = reasoningEffort
    ? menu.efforts.find((option) => option.id === reasoningEffort)
    : undefined;
  const modelLabel = model ? menu.triggerModelLabel(modelOption?.label ?? model) : undefined;
  const reasoningLabel = reasoningEffort ? (effortOption?.label ?? reasoningEffort) : undefined;
  const speedLabel = serviceTier === 'priority' ? 'Fast' : 'Standard';
  const accessLabel = autoApprove === true ? 'Full access' : menu.access.sandboxed;
  const triggerLabel =
    [modelLabel, reasoningLabel, menu.hasSpeed && serviceTier === 'priority' && 'Fast']
      .filter(Boolean)
      .join(' · ') || 'Default';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="xs" variant="ghost" aria-label="Model and reasoning options">
            <SlidersHorizontalIcon className="h-3 w-3" />
            {triggerLabel}
            {autoApprove === true && (
              <span className="text-foreground-destructive">· Full access</span>
            )}
            <ChevronDownIcon className="h-3 w-3 text-foreground-passive" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuSub>
          <SettingsSubTrigger label="Reasoning" value={menuValueLabel(reasoningLabel)} />
          <DropdownMenuSubContent className="w-52">
            <DropdownMenuRadioGroup
              value={reasoningEffort ?? 'default'}
              onValueChange={(next) =>
                onChange({
                  reasoningEffort: next === 'default' ? null : (next as NativeChatReasoningEffort),
                })
              }
            >
              <DropdownMenuRadioItem value="default">Default</DropdownMenuRadioItem>
              {menu.efforts.map((option) => (
                <DropdownMenuRadioItem key={option.id} value={option.id}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {menu.models.length > 0 && (
          <DropdownMenuSub>
            <SettingsSubTrigger label="Model" value={menuValueLabel(modelLabel)} />
            <DropdownMenuSubContent className="w-64">
              <DropdownMenuRadioGroup
                value={model ?? 'default'}
                onValueChange={(next) => onChange({ model: next === 'default' ? null : next })}
              >
                <DropdownMenuRadioItem value="default">Default</DropdownMenuRadioItem>
                {menu.models.map((option) => (
                  <DropdownMenuRadioItem key={option.id} value={option.id}>
                    <OptionItemContent label={option.label} description={option.description} />
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {menu.hasSpeed && (
          <DropdownMenuSub>
            <SettingsSubTrigger label="Speed" value={speedLabel} />
            <DropdownMenuSubContent className="w-56">
              <DropdownMenuRadioGroup
                value={serviceTier ?? 'default'}
                onValueChange={(next) =>
                  onChange({ serviceTier: next === 'default' ? null : (next as CodexServiceTier) })
                }
              >
                <DropdownMenuRadioItem value="default">
                  <OptionItemContent label="Standard" description="Default speed" />
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="priority">
                  <OptionItemContent label="Fast" description="1.5x speed, increased usage" />
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <SettingsSubTrigger
            label="Access"
            value={accessLabel}
            destructive={autoApprove === true}
          />
          <DropdownMenuSubContent className="w-64">
            <DropdownMenuRadioGroup
              value={autoApprove === true ? 'full' : 'sandboxed'}
              onValueChange={(next) => onChange({ autoApprove: next === 'full' })}
            >
              <DropdownMenuRadioItem value="sandboxed">
                <OptionItemContent
                  label={menu.access.sandboxed}
                  description={menu.access.sandboxedDescription}
                />
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="full">
                <OptionItemContent label="Full access" description={menu.access.fullDescription} />
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkingIndicator() {
  return (
    <div className="flex items-center gap-2 text-xs text-foreground-passive" role="status">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-in-progress" />
      Working…
    </div>
  );
}

function ChatEmptyState({ providerId }: { providerId: NativeChatProviderId }) {
  const meta = agentMeta[providerId];
  const label = meta.label;
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center px-6">
      {meta.icon && (
        <AgentLogo
          logo={meta.icon}
          logoDark={meta.iconDark}
          alt={meta.alt ?? label}
          isSvg={meta.isSvg}
          invertInDark={meta.invertInDark}
          className="h-8 w-8 opacity-95"
        />
      )}
      <div className="mt-4 flex max-w-xs flex-col items-center gap-1.5 text-center">
        <div className="text-sm font-medium text-foreground">Start a focused task</div>
        <p className="text-xs leading-relaxed text-foreground-passive">
          {label} will run in this worktree and stream progress here.
        </p>
      </div>
    </div>
  );
}

const SLASH_GROUP_LABELS: Record<NativeChatSlashEntry['group'], string> = {
  command: 'Commands',
  model: 'Models',
  reasoning: 'Reasoning',
  'skill-active': 'Skills',
  'skill-shared': 'Shared skills',
  'skill-other': 'Other skills',
};

function SlashMenu({
  entries,
  activeIndex,
  onSelect,
}: {
  entries: NativeChatSlashEntry[];
  activeIndex: number;
  onSelect: (entry: NativeChatSlashEntry) => void;
}) {
  let previousGroup: NativeChatSlashEntry['group'] | null = null;

  return (
    <div
      className="absolute bottom-full left-2 z-20 mb-2 max-h-80 w-[min(28rem,calc(100%-1rem))] overflow-y-auto rounded-lg border border-border bg-background-quaternary p-1 shadow-2xl"
      role="listbox"
      aria-label="Slash commands"
    >
      {entries.map((entry, index) => {
        const showGroup = entry.group !== previousGroup;
        previousGroup = entry.group;

        return (
          <React.Fragment key={entry.id}>
            {showGroup && (
              <div className="px-2 pt-2 pb-1 text-tiny font-medium tracking-wide text-foreground-passive uppercase first:pt-1">
                {SLASH_GROUP_LABELS[entry.group]}
              </div>
            )}
            <button
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(entry);
              }}
              className={cn(
                'flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left',
                index === activeIndex
                  ? 'bg-background-tertiary text-foreground'
                  : 'text-foreground-muted hover:bg-background-tertiary hover:text-foreground'
              )}
            >
              <span className="truncate text-sm font-medium">{entry.label}</span>
              {entry.detail && (
                <span className="line-clamp-2 text-xs leading-snug text-foreground-passive">
                  {entry.detail}
                </span>
              )}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export const NativeChatPanel = observer(function NativeChatPanel({
  conversation,
}: {
  conversation: ConversationStore;
}) {
  const { id: conversationId, projectId, taskId, providerId } = conversation.data;
  assertNativeChatProvider(providerId);
  const nativeProviderId: NativeChatProviderId = providerId;
  const providerLabel = agentMeta[nativeProviderId].label;
  const store = useMemo(
    () => new NativeChatStore(projectId, taskId, conversationId),
    [projectId, taskId, conversationId]
  );
  useEffect(() => () => store.dispose(), [store]);

  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [installedSkills, setInstalledSkills] = useState<CatalogSkill[]>([]);
  const [selectionStart, setSelectionStart] = useState(0);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [dismissedSlashKey, setDismissedSlashKey] = useState<string | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: Iterable<File>) => {
    for (const file of files) {
      const path = await resolveDroppedFile(file);
      if (!path) continue;
      const isImage = file.type.startsWith('image/');
      const attachment: ComposerAttachment = {
        path,
        kind: isImage ? 'image' : 'file',
        name: file.name || undefined,
        previewUrl: isImage ? URL.createObjectURL(file) : undefined,
      };
      setAttachments((current) => {
        if (current.some((existing) => existing.path === path)) {
          if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
          return current;
        }
        return [...current, attachment];
      });
    }
  };

  const removeAttachment = (attachment: ComposerAttachment) => {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    setAttachments((current) => current.filter((existing) => existing.path !== attachment.path));
  };

  // Revoke any outstanding preview object URLs when the panel unmounts.
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  useEffect(
    () => () => {
      for (const attachment of attachmentsRef.current) {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      }
    },
    []
  );

  const handlePaste = (event: React.ClipboardEvent) => {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    void addFiles(files);
  };

  // Highlight the composer while a file drag hovers it. dragleave fires on
  // every child boundary, so track enter/leave depth instead of a boolean.
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  const dragHasFiles = (event: React.DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');

  const handleDragEnter = (event: React.DragEvent) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    if (!dragHasFiles(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragOver(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    dragDepthRef.current = 0;
    setIsDragOver(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    void addFiles(files);
  };

  const { items, turnStatus, lastError, turnDurationsMs } = store.transcript;
  const isRunning = turnStatus === 'running';
  const segments = useMemo(() => groupChatItems(items), [items]);

  // Attach "Worked for Ns" to the last activity group of each turn only.
  const lastActivityIndexByTurn = useMemo(() => {
    const byTurn = new Map<string, number>();
    segments.forEach((segment, index) => {
      if (segment.type === 'activity') byTurn.set(turnKeyOf(segment.key), index);
    });
    return byTurn;
  }, [segments]);

  // Keep the transcript pinned to the bottom unless the user scrolled away.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items, isRunning, stickToBottom]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [conversationId]);

  useEffect(() => {
    let cancelled = false;
    void rpc.skills
      .getCatalog()
      .then((result) => {
        if (cancelled || !result.success || !result.data) return;
        setInstalledSkills(result.data.skills.filter((skill) => skill.installed));
      })
      .catch(() => {
        if (!cancelled) setInstalledSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setStickToBottom(el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_STICK_THRESHOLD_PX);
  };

  const scrollToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setStickToBottom(true);
  };

  // Inline code spans that look like workspace files open in the file editor.
  const handleOpenFile = useMemo(
    () => (path: string) => void openFileInTaskEditor(projectId, taskId, path),
    [projectId, taskId]
  );

  const canSend =
    (draft.trim().length > 0 || attachments.length > 0) && !isRunning && !store.isSending;

  const slashTrigger = useMemo(
    () => getNativeChatSlashTrigger(draft, selectionStart),
    [draft, selectionStart]
  );
  const slashKey = slashTrigger ? `${slashTrigger.start}:${slashTrigger.end}:${draft}` : null;
  const slashEntries = useMemo(() => {
    const entries = buildNativeChatSlashEntries({
      providerId: nativeProviderId,
      currentModel: conversation.data.model,
      installedSkills,
    });
    return filterNativeChatSlashEntries(entries, slashTrigger?.query ?? '');
  }, [conversation.data.model, installedSkills, nativeProviderId, slashTrigger?.query]);
  const showSlashMenu =
    !isRunning &&
    slashTrigger !== null &&
    slashEntries.length > 0 &&
    dismissedSlashKey !== slashKey;

  useEffect(() => {
    setSlashActiveIndex(0);
  }, [slashTrigger?.query, nativeProviderId]);

  useEffect(() => {
    if (slashActiveIndex >= slashEntries.length) {
      setSlashActiveIndex(Math.max(0, slashEntries.length - 1));
    }
  }, [slashActiveIndex, slashEntries.length]);

  const updateSelectionStart = (target: HTMLTextAreaElement) => {
    setSelectionStart(target.selectionStart);
    const nextTrigger = getNativeChatSlashTrigger(target.value, target.selectionStart);
    const nextSlashKey = nextTrigger
      ? `${nextTrigger.start}:${nextTrigger.end}:${target.value}`
      : null;
    setDismissedSlashKey((current) => (current === nextSlashKey ? current : null));
  };

  const placeCaret = (position: number) => {
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(position, position);
      setSelectionStart(position);
    });
  };

  const selectSlashEntry = (entry: NativeChatSlashEntry) => {
    if (!slashTrigger) return;

    const replacement = entry.action.type === 'insert' ? entry.action.text : '';
    const nextDraft = replaceSlashTrigger(draft, slashTrigger, replacement);
    const nextCaret = slashTrigger.start + replacement.length;
    setDraft(nextDraft);
    setDismissedSlashKey(null);
    placeCaret(nextCaret);

    if (entry.action.type === 'set-options') {
      void store.setOptions(entry.action.options);
    } else if (entry.action.type === 'switch-terminal') {
      void store.switchToTerminal();
    }
  };

  const submit = () => {
    if (!canSend) return;
    const text = draft.trim();
    const sentAttachments = attachments.map(({ previewUrl, ...attachment }) => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      return attachment;
    });
    setDraft('');
    setAttachments([]);
    void store.send(text, sentAttachments);
  };

  const showEmptyState = !store.isLoading && items.length === 0 && !isRunning && !lastError;
  const errorMessage = lastError ?? store.sendError;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {showEmptyState ? (
        <ChatEmptyState providerId={nativeProviderId} />
      ) : (
        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto">
            <div className={cn(COLUMN, 'flex flex-col gap-4 px-4 py-4')}>
              {segments.map((segment, index) =>
                segment.type === 'activity' ? (
                  <ActivityGroupView
                    key={segment.key}
                    items={segment.items}
                    live={isRunning && index === segments.length - 1}
                    durationMs={
                      lastActivityIndexByTurn.get(turnKeyOf(segment.key)) === index
                        ? turnDurationsMs[turnKeyOf(segment.key)]
                        : undefined
                    }
                  />
                ) : (
                  <ChatItemView
                    key={segment.item.key}
                    item={segment.item}
                    onOpenFile={handleOpenFile}
                  />
                )
              )}
              {isRunning && <WorkingIndicator />}
            </div>
          </div>
          {!stickToBottom && (
            <Button
              variant="outline"
              size="xs"
              onClick={scrollToLatest}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-sm"
            >
              <ArrowDownIcon className="h-3 w-3" />
              Latest
            </Button>
          )}
        </div>
      )}

      <div className={cn(COLUMN, 'flex flex-col gap-2 px-4 pb-3')}>
        {errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>{providerLabel} native chat hit a problem</AlertTitle>
            <AlertDescription className="break-words">{errorMessage}</AlertDescription>
            <AlertAction>
              <Button
                size="sm"
                variant="outline"
                disabled={store.isSwitching}
                onClick={() => void store.switchToTerminal()}
              >
                Switch to CLI terminal
              </Button>
            </AlertAction>
          </Alert>
        )}

        <div
          className={cn(
            'relative rounded-xl border border-border bg-background transition-colors focus-within:border-border-2',
            isDragOver && 'border-border-primary ring-2 ring-primary/30'
          )}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
        >
          {showSlashMenu && (
            <SlashMenu
              entries={slashEntries}
              activeIndex={slashActiveIndex}
              onSelect={selectSlashEntry}
            />
          )}
          {attachments.length > 0 && (
            <div className="flex flex-wrap items-end gap-1.5 px-2 pt-2">
              {attachments.map((attachment) =>
                attachment.previewUrl ? (
                  <span
                    key={attachment.path}
                    className="group relative h-14 w-14 overflow-hidden rounded-md border border-border/60"
                  >
                    <img
                      src={attachment.previewUrl}
                      alt={attachment.name || 'Attached image'}
                      className="h-full w-full object-cover"
                    />
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Remove ${attachment.name ?? 'attachment'}`}
                      onClick={() => removeAttachment(attachment)}
                      className="absolute top-0.5 right-0.5 size-4 bg-background/80 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <XIcon className="h-2.5 w-2.5" />
                    </Button>
                  </span>
                ) : (
                  <span
                    key={attachment.path}
                    className="flex h-6 max-w-56 items-center gap-1 rounded-md border border-border/60 bg-background-1 pr-0.5 pl-1.5 text-xs text-foreground-muted"
                  >
                    {attachment.kind === 'image' ? (
                      <ImageIcon className="h-3 w-3 shrink-0 text-foreground-passive" />
                    ) : (
                      <FileIcon className="h-3 w-3 shrink-0 text-foreground-passive" />
                    )}
                    <span className="min-w-0 truncate">
                      {attachment.name || attachment.path.split('/').pop()}
                    </span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Remove ${attachment.name ?? 'attachment'}`}
                      onClick={() => removeAttachment(attachment)}
                      className="size-4"
                    >
                      <XIcon className="h-2.5 w-2.5" />
                    </Button>
                  </span>
                )
              )}
            </div>
          )}
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              updateSelectionStart(e.target);
            }}
            onPaste={handlePaste}
            onClick={(e) => updateSelectionStart(e.currentTarget)}
            onSelect={(e) => updateSelectionStart(e.currentTarget)}
            onKeyUp={(e) => updateSelectionStart(e.currentTarget)}
            onKeyDown={(e) => {
              if (showSlashMenu) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSlashActiveIndex((index) => (index + 1) % slashEntries.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSlashActiveIndex(
                    (index) => (index - 1 + slashEntries.length) % slashEntries.length
                  );
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  selectSlashEntry(slashEntries[slashActiveIndex]);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setDismissedSlashKey(slashKey);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
                return;
              }
              if (e.key === 'Escape' && isRunning) {
                e.preventDefault();
                void store.interrupt();
              }
            }}
            placeholder={isRunning ? `${providerLabel} is working…` : `Message ${providerLabel}`}
            aria-label={`Message ${providerLabel}`}
            rows={1}
            className="max-h-48 min-h-0 resize-none border-0 bg-transparent px-3 pt-2.5 pb-1 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                void addFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <TooltipProvider delay={150}>
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Attach files or images"
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Attach files or images (or paste/drop them)</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <div className="flex-1" />
            <TooltipProvider delay={150}>
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={store.isSwitching}
                    onClick={() => void store.switchToTerminal()}
                    aria-label="Switch to CLI terminal"
                  >
                    <TerminalIcon className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Switch this conversation to the CLI terminal</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <ModelOptionsMenu
              providerId={nativeProviderId}
              model={conversation.data.model}
              reasoningEffort={conversation.data.reasoningEffort}
              serviceTier={conversation.data.serviceTier}
              autoApprove={conversation.data.autoApprove}
              onChange={(options) => void store.setOptions(options)}
            />
            {isRunning ? (
              <TooltipProvider delay={150}>
                <Tooltip>
                  <TooltipTrigger>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() => void store.interrupt()}
                      aria-label={`Stop ${providerLabel}`}
                      className="rounded-full"
                    >
                      <SquareIcon className="h-2.5 w-2.5 fill-current" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Stop (Esc)</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <Button
                size="icon-sm"
                disabled={!canSend}
                onClick={submit}
                aria-label="Send message"
                className="rounded-full"
              >
                <ArrowUpIcon className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
