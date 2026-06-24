/**
 * ChatComposer
 *
 * The prompt input shell for the chat panel. Layout:
 *
 *   ┌────────────────────────────────────────────────────┐
 *   │ [Image previews 32x32 — shown only when present]   │
 *   │ [TipTap editor — auto-grows, max 200px, scrolls]   │
 *   ├────────────────────────────────────────────────────┤
 *   │ [Agent] [Model selector]    [Attach?] [Stop | ↑]   │
 *   └────────────────────────────────────────────────────┘
 *
 * Delegates input and attachment state to the caller via props (host-controlled).
 * Drag-and-drop:
 *   - Dropped images create ComposerAttachment entries (via onAttachmentsChange).
 *   - All dropped files are forwarded to onFilesDropped so the host can resolve
 *     absolute paths and insert them as path mentions via the editorApiRef.
 */

import { ArrowUp, CircleAlert, Paperclip, Square, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { Button } from '../primitives/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
} from '../primitives/combobox';
import { ComboboxPopover } from './combobox-popover';
import { PermissionBand } from './permission-band';
import type { ComposerPermissionRequest } from './permission-band';
import { PromptEditor } from './prompt-editor/prompt-editor';
import type {
  CommandItem,
  ContextMentionProvider,
  MentionItem,
  PromptEditorRef,
} from './prompt-editor/types';
import * as styles from './chat-composer.css';

export type { MentionItem, CommandItem as ComposerCommandItem };
export type { MentionKind, CommandBehavior, ContextMentionProvider } from './prompt-editor/types';

// ── Session-state notice ──────────────────────────────────────────────────────

export type ComposerNoticeVariant = 'error' | 'warning' | 'info';

export interface ComposerNotice {
  variant: ComposerNoticeVariant;
  title?: string;
  message: string;
  /** When provided, renders a dismiss button. */
  onDismiss?: () => void;
}

/**
 * Map an ACP stop reason to a composer notice. Returns null for reasons that
 * are not user-facing errors (end_turn, cancelled, unknown). Accepts a plain
 * string so callers can forward the ACP StopReason without this package
 * importing the ACP SDK.
 */
export function stopReasonNotice(reason: string): ComposerNotice | null {
  switch (reason) {
    case 'max_turn_requests':
      return {
        variant: 'error',
        title: 'Turn limit reached',
        message:
          'The agent hit the maximum number of turn requests. Send a new message to continue.',
      };
    case 'max_tokens':
      return {
        variant: 'error',
        title: 'Response truncated',
        message: 'The response was cut off after reaching the maximum token limit.',
      };
    case 'refusal':
      return {
        variant: 'error',
        title: 'Request refused',
        message: 'The agent declined to continue with this request.',
      };
    default:
      return null;
  }
}

// ── Attachment types ──────────────────────────────────────────────────────────

export interface ComposerAttachment {
  id: string;
  name: string;
  /** Absolute or relative path — populated by the host for file-kind attachments. */
  path?: string;
  kind: 'image' | 'file';
  /**
   * Image source for the preview `<img>`. A `data:` URL for dropped images
   * (so the bytes can be forwarded to the agent); needs no `revokeObjectURL`.
   */
  previewUrl?: string;
  /** MIME type of the image (e.g. `image/png`) — used when sending to the agent. */
  mimeType?: string;
}

/**
 * Read a dropped image file into a `ComposerAttachment` with a `data:` URL
 * preview. On read failure the attachment is still created (without
 * `previewUrl`) so the host shows a fallback tile rather than dropping it.
 */
function readImageAttachment(file: File): Promise<ComposerAttachment> {
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

// ── Model option types ────────────────────────────────────────────────────────

/** Minimal model descriptor the composer needs to render the model selector. */
export interface ComposerModelOption {
  name: string;
  description?: string;
  /** Optional capability metadata shown in the hover card detail. */
  modelFeatures?: {
    contextWindowSize?: number;
    speed?: number;
    intelligence?: number;
  };
}

// ── Agent option types ────────────────────────────────────────────────────────

/** Minimal agent descriptor the composer needs to render the agent selector. */
export interface ComposerAgentOption {
  id: string;
  name: string;
  /**
   * Host-rendered icon — the app's AgentIcon is theme/registry aware, which
   * this package can't reach. Shown in the trigger and each list row.
   */
  icon?: React.ReactNode;
  description?: string;
  /** e.g. not installed — shown but not selectable. */
  disabled?: boolean;
  /** Optional grouping header, e.g. "Installed" / "Not installed". */
  groupLabel?: string;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ChatComposerProps {
  disabled?: boolean;
  isWorking?: boolean;
  /** False while the session is still starting up. Blocks Send/Enter but keeps the editor typeable. */
  canSubmit?: boolean;

  agentOptions?: ComposerAgentOption[] | null;
  selectedAgent?: string;
  onAgentChange?: (agentId: string) => void;
  /**
   * True once the session has history (any prompt sent). ACP cannot switch
   * agents mid-conversation, so the trigger becomes a disabled icon button.
   */
  agentLocked?: boolean;

  modelOptions?: Record<string, ComposerModelOption> | null;
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;

  onSubmit: (text: string) => void;
  onStop?: () => void;
  onAttach?: () => void;

  /**
   * Host-controlled attachment list. The composer creates image attachments
   * itself (from drag-drop) and forwards them via `onAttachmentsChange`.
   * The host is responsible for removing object URLs when clearing attachments.
   */
  attachments?: ComposerAttachment[];
  onAttachmentsChange?: (next: ComposerAttachment[]) => void;
  /**
   * Called whenever files are dropped onto the composer.
   * The host should resolve real filesystem paths and insert non-image files
   * as path mentions via the `editorApiRef` (using `insertMention`).
   */
  onFilesDropped?: (files: File[]) => void;

  /**
   * Optional ref forwarded to the inner PromptEditor imperative API, giving
   * the host access to `insertMention` (and focus/clear/getText).
   */
  editorApiRef?: React.Ref<PromptEditorRef>;

  /**
   * Called when the user clicks an image attachment thumbnail in the preview
   * strip above the editor. Host can use this to open an image viewer dialog.
   */
  onViewImage?: (att: ComposerAttachment) => void;

  /**
   * Preferred: typed provider for @ mention suggestions.
   * When both `mentionProvider` and `queryMentions` are provided,
   * `mentionProvider` takes precedence.
   */
  mentionProvider?: ContextMentionProvider;
  /** Legacy: async callback returning @ mention suggestions for the given query. */
  queryMentions?: (query: string) => Promise<MentionItem[]>;
  /** Async callback returning / command suggestions for the given query. */
  queryCommands?: (query: string) => Promise<CommandItem[]>;
  /** Called when a / command with behavior='execute' is selected. */
  onCommand?: (item: CommandItem) => void;
  /** Session-state notice shown flush above the input (e.g. ACP stop reasons). */
  notice?: ComposerNotice | null;
  /**
   * Pending ACP permission request to show in the band above the input.
   * When present, the notice band is replaced by the permission band.
   * Pass null/undefined when no request is pending.
   */
  permissionRequest?: ComposerPermissionRequest | null;
  /** Total number of queued permission requests. Drives the "1 of N" counter. */
  permissionQueueCount?: number;
  /** Called with the chosen optionId when the user resolves a permission request. */
  onResolvePermission?: (optionId: string | null) => void;
  className?: string;
}

// ── Internal model item type ──────────────────────────────────────────────────

interface ModelItem {
  id: string;
  name: string;
  description?: string;
  modelFeatures?: ComposerModelOption['modelFeatures'];
}

// ── Model detail hover card ───────────────────────────────────────────────────

function ModelDetailCard({ item }: { item: ModelItem }) {
  const { name, description, modelFeatures } = item;
  const hasFeatures =
    modelFeatures &&
    (modelFeatures.contextWindowSize !== undefined ||
      modelFeatures.speed !== undefined ||
      modelFeatures.intelligence !== undefined);

  return (
    <div className={styles.modelDetailCard}>
      <p className={styles.modelDetailName}>{name}</p>
      {description && <p className={styles.modelDetailDesc}>{description}</p>}
      {hasFeatures && (
        <div className={styles.modelDetailFeatures}>
          {modelFeatures?.contextWindowSize !== undefined && (
            <ModelFeatureRow
              label="Context"
              value={formatContextWindow(modelFeatures.contextWindowSize)}
            />
          )}
          {modelFeatures?.speed !== undefined && (
            <ModelFeatureRow label="Speed" value={<BarMeter value={modelFeatures.speed} />} />
          )}
          {modelFeatures?.intelligence !== undefined && (
            <ModelFeatureRow
              label="Intelligence"
              value={<BarMeter value={modelFeatures.intelligence} />}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ModelFeatureRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.modelDetailRow}>
      <span className={styles.modelDetailLabel}>{label}</span>
      <span className={styles.modelDetailValue}>{value}</span>
    </div>
  );
}

function BarMeter({ value }: { value: number }) {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * 5);
  return (
    <span className={styles.barMeter}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < filled ? styles.barDotFilled : styles.barDotEmpty} />
      ))}
    </span>
  );
}

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(0)}M tokens`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K tokens`;
  return `${tokens} tokens`;
}

// ── Notice band ───────────────────────────────────────────────────────────────

function NoticeBand({ notice }: { notice: ComposerNotice }) {
  return (
    <div className={styles.noticeBand({ variant: notice.variant })}>
      <div className={styles.noticeBandBody}>
        <div className={styles.noticeBandHeader}>
          <CircleAlert style={{ width: '0.875rem', height: '0.875rem', flexShrink: 0 }} />
          {notice.title && <p className={styles.noticeBandTitle}>{notice.title}</p>}
        </div>
        <p
          className={cn(styles.noticeBandMessage, notice.title && styles.noticeBandMessageIndented)}
        >
          {notice.message}
        </p>
      </div>
      {notice.onDismiss && (
        <button
          type="button"
          aria-label="Dismiss notice"
          onClick={notice.onDismiss}
          className={styles.noticeDismiss}
        >
          <X style={{ width: '0.875rem', height: '0.875rem' }} />
        </button>
      )}
    </div>
  );
}

// ── Agent selector ────────────────────────────────────────────────────────────

interface AgentGroup {
  label: string;
  items: ComposerAgentOption[];
}

function buildAgentGroups(options: ComposerAgentOption[]): AgentGroup[] {
  const grouped = new Map<string, ComposerAgentOption[]>();
  for (const opt of options) {
    const label = opt.groupLabel ?? '';
    const existing = grouped.get(label);
    if (existing) {
      existing.push(opt);
    } else {
      grouped.set(label, [opt]);
    }
  }
  return Array.from(grouped.entries()).map(([label, items]) => ({ label, items }));
}

interface ComposerAgentSelectorProps {
  options: ComposerAgentOption[];
  selectedId?: string;
  onSelect: (agentId: string) => void;
  locked: boolean;
  disabled: boolean;
}

function ComposerAgentSelector({
  options,
  selectedId,
  onSelect,
  locked,
  disabled,
}: ComposerAgentSelectorProps) {
  const [open, setOpen] = useState(false);
  const selected = selectedId ? (options.find((o) => o.id === selectedId) ?? null) : null;
  const groups = buildAgentGroups(options);
  const isDisabled = disabled || locked;

  const triggerLabel = selected
    ? locked
      ? `${selected.name} — agents can't be switched after a conversation starts`
      : selected.name
    : 'Select agent';

  // When locked or session closed, show a static disabled icon button.
  if (isDisabled) {
    return (
      <Button
        variant="ghost"
        size="sm"
        icon
        disabled
        aria-label={triggerLabel}
        title={triggerLabel}
      >
        {selected?.icon ?? <span style={{ width: '1rem', height: '1rem' }} />}
      </Button>
    );
  }

  return (
    <Combobox
      value={selected ?? null}
      onValueChange={(item: ComposerAgentOption | null) => {
        if (!item || item.disabled) return;
        onSelect(item.id);
        setOpen(false);
      }}
      open={open}
      onOpenChange={(next) => setOpen(next)}
      isItemEqualToValue={(a: ComposerAgentOption, b: ComposerAgentOption) => a.id === b.id}
      filter={(item: ComposerAgentOption, query: string) =>
        item.name.toLowerCase().includes(query.toLowerCase())
      }
      autoHighlight
    >
      <ComboboxTrigger
        aria-label={triggerLabel}
        title={triggerLabel}
        className={styles.agentTrigger}
      >
        {selected?.icon ?? <span className={styles.agentIconPlaceholder} />}
      </ComboboxTrigger>
      <ComboboxContent style={{ minWidth: '11.25rem' }}>
        <ComboboxInput showTrigger={false} placeholder="Search agents…" />
        <ComboboxList>
          {groups.map((group) =>
            group.label ? (
              <ComboboxGroup key={group.label}>
                <ComboboxLabel>{group.label}</ComboboxLabel>
                {group.items.map((item) => (
                  <ComboboxItem key={item.id} value={item} disabled={item.disabled}>
                    {item.icon && <span style={{ flexShrink: 0 }}>{item.icon}</span>}
                    <span
                      style={{
                        minWidth: 0,
                        flex: '1 1 0%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.name}
                    </span>
                  </ComboboxItem>
                ))}
              </ComboboxGroup>
            ) : (
              group.items.map((item) => (
                <ComboboxItem key={item.id} value={item} disabled={item.disabled}>
                  {item.icon && <span style={{ flexShrink: 0 }}>{item.icon}</span>}
                  <span
                    style={{
                      minWidth: 0,
                      flex: '1 1 0%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.name}
                  </span>
                </ComboboxItem>
              ))
            )
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ChatComposer({
  disabled = false,
  isWorking = false,
  canSubmit = true,
  agentOptions,
  selectedAgent,
  onAgentChange,
  agentLocked = false,
  modelOptions,
  selectedModel,
  onModelChange,
  onSubmit,
  onStop,
  onAttach,
  attachments = [],
  onAttachmentsChange,
  onFilesDropped,
  editorApiRef,
  mentionProvider,
  queryMentions,
  queryCommands,
  onCommand,
  onViewImage,
  notice,
  permissionRequest,
  permissionQueueCount = 1,
  onResolvePermission,
  className,
}: ChatComposerProps) {
  const editorRef = useRef<PromptEditorRef | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Retain the last notice so its content stays rendered while the band
  // collapses out, letting the exit transition play before unmount.
  const [retainedNotice, setRetainedNotice] = useState<ComposerNotice | null>(notice ?? null);
  useEffect(() => {
    if (notice) setRetainedNotice(notice);
  }, [notice]);

  // Revoke object URLs for image attachments on unmount to avoid leaks.
  useEffect(() => {
    const current = attachments;
    return () => {
      current.forEach((att) => {
        if (att.kind === 'image' && att.previewUrl) {
          URL.revokeObjectURL(att.previewUrl);
        }
      });
    };
    // Intentionally omit `attachments` from deps — only run on unmount.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (text: string) => {
    // Allow image-only sends: a message with attachments but no text is valid.
    const hasImages = attachments.some((a) => a.kind === 'image');
    if ((!text.trim() && !hasImages) || disabled || !canSubmit) return;
    onSubmit(text);
  };

  // ── Drag-and-drop ───────────────────────────────────────────────────────────

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!dragActive) setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // Only clear when leaving the root element itself (not a child).
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length > 0 && onAttachmentsChange) {
      const base = attachments;
      void Promise.all(imageFiles.map(readImageAttachment)).then((newAttachments) => {
        onAttachmentsChange([...base, ...newAttachments]);
      });
    }

    onFilesDropped?.(files);
  };

  // ── Attachment removal ──────────────────────────────────────────────────────

  const removeAttachment = (id: string) => {
    const att = attachments.find((a) => a.id === id);
    if (att?.kind === 'image' && att.previewUrl) {
      URL.revokeObjectURL(att.previewUrl);
    }
    onAttachmentsChange?.(attachments.filter((a) => a.id !== id));
  };

  const imageAttachments = attachments.filter((a) => a.kind === 'image');

  // ── Model items ─────────────────────────────────────────────────────────────

  const modelItems: ModelItem[] = modelOptions
    ? Object.entries(modelOptions).map(([id, opt]) => ({ id, ...opt }))
    : [];

  // The permission band takes priority over the notice band.
  const hasBand = !!(permissionRequest ?? notice);

  return (
    <div className={cn(styles.composerRoot, className)}>
      {/* Permission band — shown when the agent is awaiting user approval. */}
      {permissionRequest && onResolvePermission && (
        <PermissionBand
          request={permissionRequest}
          queueCount={permissionQueueCount}
          onResolve={onResolvePermission}
        />
      )}

      {/* Notice band — height + opacity animate on enter/exit via the
          grid-rows 0fr↔1fr technique so add/remove transitions are smooth.
          Hidden when the permission band is active. */}
      {!permissionRequest && (
        <div
          className={cn(
            styles.noticeAnimWrapper,
            notice ? styles.noticeAnimVisible : styles.noticeAnimHidden
          )}
          aria-hidden={!notice}
        >
          <div className={styles.noticeOverflowClip}>
            {retainedNotice && <NoticeBand notice={retainedNotice} />}
          </div>
        </div>
      )}

      <div
        className={styles.composerShell({ hasBand: !!hasBand, dragActive })}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Image attachment previews */}
        {imageAttachments.length > 0 && (
          <div className={styles.attachmentStrip}>
            {imageAttachments.map((att) => (
              <div key={att.id} className={styles.attachmentThumb} data-attachment-thumb>
                <button
                  type="button"
                  aria-label={`View image: ${att.name}`}
                  onClick={() => onViewImage?.(att)}
                  className={styles.attachmentThumbBtn}
                >
                  <img src={att.previewUrl} alt={att.name} className={styles.attachmentThumbImg} />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${att.name}`}
                  onClick={() => removeAttachment(att.id)}
                  className={styles.attachmentRemoveBtn}
                >
                  <X style={{ width: '0.625rem', height: '0.625rem' }} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Editor area */}
        <div className={styles.editorArea}>
          <PromptEditor
            ref={(handle) => {
              editorRef.current = handle;
              if (editorApiRef) {
                if (typeof editorApiRef === 'function') {
                  editorApiRef(handle);
                } else {
                  (editorApiRef as React.MutableRefObject<PromptEditorRef | null>).current = handle;
                }
              }
            }}
            placeholder={
              disabled ? 'Session closed' : !canSubmit ? 'Waiting for agent…' : 'Message…'
            }
            disabled={disabled}
            onSubmit={handleSubmit}
            mentionProvider={mentionProvider}
            queryMentions={queryMentions}
            queryCommands={queryCommands}
            onCommand={onCommand}
          />
        </div>

        {/* Toolbar */}
        <div className={styles.toolbar}>
          {/* Left: agent + model selector */}
          <div className={styles.toolbarLeft}>
            {agentOptions && agentOptions.length > 0 && (
              <ComposerAgentSelector
                options={agentOptions}
                selectedId={selectedAgent}
                onSelect={(id) => onAgentChange?.(id)}
                locked={agentLocked}
                disabled={disabled}
              />
            )}
            {modelItems.length > 0 ? (
              <ComboboxPopover<ModelItem>
                items={modelItems}
                value={selectedModel ?? null}
                onValueChange={(id) => onModelChange?.(id)}
                itemToKey={(item) => item.id}
                itemToLabel={(item) => item.name}
                disabled={disabled}
                searchPlaceholder="Search models…"
                contentStyle={{ minWidth: '12.5rem' }}
                renderTrigger={(selected) => (
                  <span
                    style={{
                      color: selected ? 'var(--foreground)' : 'var(--foreground-muted)',
                      fontSize: 'var(--text-xs)',
                    }}
                  >
                    {selected?.name ?? 'Model…'}
                  </span>
                )}
                renderItem={(item) => (
                  <span
                    style={{
                      flex: '1 1 0%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 'var(--text-sm)',
                    }}
                  >
                    {item.name}
                  </span>
                )}
                renderItemDetail={(item) => <ModelDetailCard item={item} />}
                detailSide="right"
                detailAlign="start"
              />
            ) : (
              <span />
            )}
          </div>

          {/* Right: attach + send/stop */}
          <div className={styles.toolbarRight}>
            {onAttach && (
              <Button
                variant="ghost"
                size="sm"
                icon
                onClick={onAttach}
                disabled={disabled}
                aria-label="Add attachment"
              >
                <Paperclip />
              </Button>
            )}

            {isWorking ? (
              <Button
                variant="primary"
                tone="destructive"
                size="sm"
                onClick={onStop}
                aria-label="Stop generation"
              >
                <Square style={{ width: '0.75rem', height: '0.75rem', fill: 'currentColor' }} />
                Stop
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                icon
                className={styles.sendButtonRound}
                onClick={() => handleSubmit(editorRef.current?.getText() ?? '')}
                disabled={disabled || !canSubmit}
                aria-label="Send message"
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
