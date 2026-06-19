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

import { ArrowUp, Paperclip, Square, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { Button } from '../primitives/button';
import { ComboboxPopover } from '../primitives/combobox-popover';
import { PromptEditor } from './prompt-editor/prompt-editor';
import type {
  CommandItem,
  ContextMentionProvider,
  MentionItem,
  PromptEditorRef,
} from './prompt-editor/types';

export type { MentionItem, CommandItem };
export type { MentionKind, CommandBehavior, ContextMentionProvider } from './prompt-editor/types';

// ── Attachment types ──────────────────────────────────────────────────────────

export interface ComposerAttachment {
  id: string;
  name: string;
  /** Absolute or relative path — populated by the host for file-kind attachments. */
  path?: string;
  kind: 'image' | 'file';
  /** Blob object URL for image attachments — caller must not revoke while in use. */
  previewUrl?: string;
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
  className,
}: ChatComposerProps) {
  const editorRef = useRef<PromptEditorRef | null>(null);
  const [dragActive, setDragActive] = useState(false);

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
    if (!text.trim() || disabled || !canSubmit) return;
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
      const newAttachments: ComposerAttachment[] = imageFiles.map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        kind: 'image',
        previewUrl: URL.createObjectURL(f),
      }));
      onAttachmentsChange([...attachments, ...newAttachments]);
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
    <div
      className={cn(
        'bg-surface-base-emphasis flex flex-col gap-0 rounded-xl border transition-colors',
        dragActive
          ? 'border-border-1 ring-1 ring-border-1'
          : 'border-border hover:border-border-1 focus-within:border-border-1 focus-within:ring-1 focus-within:ring-border-1',
        className,
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
              <img
                src={att.previewUrl}
                alt={att.name}
                className="size-8 rounded-md object-cover ring-1 ring-border"
              />
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
  );
}
