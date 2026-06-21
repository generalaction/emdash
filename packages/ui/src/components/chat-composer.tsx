/**
 * ChatComposer
 *
 * The prompt input shell for the chat panel. Layout:
 *
 *   ┌────────────────────────────────────────────────────┐
 *   │ [Image previews 32x32 — shown only when present]   │
 *   │ [TipTap editor — auto-grows, max 200px, scrolls]   │
 *   ├────────────────────────────────────────────────────┤
 *   │ [Model selector]            [Attach?] [Stop | ↑]   │
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
import { ComboboxPopover } from './combobox-popover';
import { PromptEditor } from './prompt-editor/prompt-editor';
import type {
  CommandItem,
  ContextMentionProvider,
  MentionItem,
  PromptEditorRef,
} from './prompt-editor/types';

export type { MentionItem, CommandItem };
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
        message: 'The agent hit the maximum number of turn requests. Send a new message to continue.',
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

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ChatComposerProps {
  disabled?: boolean;
  isWorking?: boolean;
  /** False while the session is still starting up. Blocks Send/Enter but keeps the editor typeable. */
  canSubmit?: boolean;

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
    <div className="w-56 p-3 text-sm" style={{ color: 'var(--foreground)' }}>
      <p className="font-medium leading-tight">{name}</p>
      {description && (
        <p className="mt-1 text-xs leading-snug" style={{ color: 'var(--foreground-muted)' }}>
          {description}
        </p>
      )}
      {hasFeatures && (
        <div className="mt-2 space-y-1 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
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
    <div className="flex items-center justify-between gap-3 text-xs">
      <span style={{ color: 'var(--foreground-muted)' }}>{label}</span>
      <span style={{ color: 'var(--foreground)' }}>{value}</span>
    </div>
  );
}

function BarMeter({ value }: { value: number }) {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * 5);
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className="size-1.5 rounded-full"
          style={{ background: i < filled ? 'var(--foreground-muted)' : 'var(--border)' }}
        />
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

const NOTICE_CLASSES: Record<ComposerNoticeVariant, { container: string; icon: string }> = {
  error: {
    container:
      'bg-surface-destructive border-surface-destructive-border text-surface-destructive-foreground',
    icon: 'text-surface-destructive-foreground',
  },
  warning: {
    container:
      'bg-surface-warning border-surface-warning-border text-surface-warning-foreground',
    icon: 'text-surface-warning-foreground',
  },
  info: {
    container: 'bg-surface-info border-surface-info-border text-surface-info-foreground',
    icon: 'text-surface-info-foreground',
  },
};

function NoticeBand({ notice }: { notice: ComposerNotice }) {
  const cls = NOTICE_CLASSES[notice.variant];
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-t-xl border border-b-0 px-3 py-2 text-xs',
        cls.container,
      )}
    >
      <div className="flex-1">
        <div className="flex items-center gap-1.5">
          <CircleAlert className={cn('size-3.5 shrink-0', cls.icon)} />
          {notice.title && <p className="text-sm leading-snug">{notice.title}</p>}
        </div>
        <p className={cn('leading-snug', notice.title && 'mt-1 opacity-80')}>{notice.message}</p>
      </div>
      {notice.onDismiss && (
        <button
          type="button"
          aria-label="Dismiss notice"
          onClick={notice.onDismiss}
          className="ml-1 shrink-0 opacity-70 transition-opacity hover:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ChatComposer({
  disabled = false,
  isWorking = false,
  canSubmit = true,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Notice band — height + opacity animate on enter/exit via the
          grid-rows 0fr↔1fr technique so add/remove transitions are smooth. */}
      <div
        className={cn(
          'grid transition-all duration-200 ease-out',
          notice ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
        aria-hidden={!notice}
      >
        <div className="overflow-hidden">
          {retainedNotice && <NoticeBand notice={retainedNotice} />}
        </div>
      </div>
      <div
        className={cn(
          'bg-surface-base-emphasis flex flex-col gap-0 border transition-colors',
          notice ? 'rounded-b-xl' : 'rounded-xl',
          dragActive
            ? 'border-border-1 ring-1 ring-border-1'
            : 'border-border hover:border-border-1 focus-within:border-border-1 focus-within:ring-1 focus-within:ring-border-1',
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Image attachment previews */}
      {imageAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {imageAttachments.map((att) => (
            <div key={att.id} className="group relative size-8">
              <button
                type="button"
                aria-label={`View image: ${att.name}`}
                onClick={() => onViewImage?.(att)}
                className="block size-8 rounded-md p-0 focus-visible:outline-2 focus-visible:outline-offset-1"
              >
                <img
                  src={att.previewUrl}
                  alt={att.name}
                  className="size-8 rounded-md object-cover ring-1 ring-border"
                />
              </button>
              <button
                type="button"
                aria-label={`Remove ${att.name}`}
                onClick={() => removeAttachment(att.id)}
                className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-surface text-foreground ring-1 ring-border opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X className="size-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Editor area */}
      <div className="max-h-[200px] overflow-y-auto px-3 pt-3 pb-1">
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
      <div className="flex items-center justify-between px-2 pt-1 pb-2">
        {/* Left: model selector */}
        <div className="flex items-center gap-1.5">
          {modelItems.length > 0 ? (
            <ComboboxPopover<ModelItem>
              items={modelItems}
              value={selectedModel ?? null}
              onValueChange={(id) => onModelChange?.(id)}
              itemToKey={(item) => item.id}
              itemToLabel={(item) => item.name}
              disabled={disabled}
              searchPlaceholder="Search models…"
              contentClassName="min-w-[200px]"
              renderTrigger={(selected) => (
                <span
                  className={cn('text-xs', selected ? 'text-foreground' : 'text-foreground-muted')}
                >
                  {selected?.name ?? 'Model…'}
                </span>
              )}
              renderItem={(item) => (
                <span className="flex-1 truncate text-sm">{item.name}</span>
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
        <div className="flex items-center gap-1">
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
              <Square className="size-3 fill-current" />
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              icon
              className="rounded-full"
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
