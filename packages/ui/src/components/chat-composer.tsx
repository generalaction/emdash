/**
 * ChatComposer
 *
 * The prompt input shell for the chat panel. Layout:
 *
 *   ┌────────────────────────────────────────────────────┐
 *   │ [TipTap editor — auto-grows, max 200px, scrolls]   │
 *   ├────────────────────────────────────────────────────┤
 *   │ [Model selector]          [Attach?] [Stop | Send]  │
 *   └────────────────────────────────────────────────────┘
 *
 * Delegates input state and submit/cancel to the caller via props.
 * The PromptEditor component is data-source-agnostic; queryMentions /
 * queryCommands are passed in as props so the host application can wire
 * real context-search sources without touching this package.
 */

import { Paperclip, Send, Square } from 'lucide-react';
import { useRef } from 'react';
import { cn } from '../lib/cn';
import { Button } from '../primitives/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../primitives/select';
import { PromptEditor } from './prompt-editor/prompt-editor';
import type { MentionItem, CommandItem, PromptEditorRef } from './prompt-editor/types';

export type { MentionItem, CommandItem };
export type { MentionKind, CommandBehavior } from './prompt-editor/types';

/** Minimal model descriptor the composer needs to render the model selector. */
export interface ComposerModelOption {
  name: string;
  description?: string;
}

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
  /** Async callback returning @ mention suggestions for the given query. */
  queryMentions?: (query: string) => Promise<MentionItem[]>;
  /** Async callback returning / command suggestions for the given query. */
  queryCommands?: (query: string) => Promise<CommandItem[]>;
  /** Called when a / command with behavior='execute' is selected. */
  onCommand?: (item: CommandItem) => void;
  className?: string;
}

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
  queryMentions,
  queryCommands,
  onCommand,
  className,
}: ChatComposerProps) {
  const editorRef = useRef<PromptEditorRef | null>(null);

  const handleSubmit = (text: string) => {
    if (!text.trim() || disabled || !canSubmit) return;
    onSubmit(text);
  };

  return (
    <div
      className={cn(
        'surface-elevated flex flex-col gap-0 rounded-xl border border-border bg-surface',
        className,
      )}
    >
      {/* Editor area */}
      <div className="max-h-[200px] overflow-y-auto px-3 pt-3 pb-1">
        <PromptEditor
          ref={editorRef}
          placeholder={
            disabled ? 'Session closed' : !canSubmit ? 'Waiting for agent…' : 'Message…'
          }
          disabled={disabled}
          onSubmit={handleSubmit}
          queryMentions={queryMentions}
          queryCommands={queryCommands}
          onCommand={onCommand}
        />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 pt-1 pb-2">
        {/* Left: model selector */}
        <div className="flex items-center gap-1.5">
          {modelOptions ? (
              <Select
                value={selectedModel}
                onValueChange={(v) => v !== null && onModelChange?.(v)}
                disabled={disabled}
              >
              <SelectTrigger size="sm" className="max-w-[180px]">
                <SelectValue placeholder="Model…" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(modelOptions).map(([id, opt]) => (
                  <SelectItem key={id} value={id} title={opt.description}>
                    {opt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              onClick={() => {
                const text = editorRef.current?.getText() ?? '';
                handleSubmit(text);
              }}
              disabled={disabled || !canSubmit}
              aria-label="Send message"
            >
              <Send />
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
