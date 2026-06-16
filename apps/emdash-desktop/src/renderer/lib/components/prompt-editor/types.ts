/**
 * Public types for the PromptEditor component.
 * Keep this file dependency-free (no TipTap imports) so consumers can type-check
 * without pulling the whole editor bundle.
 */

// ── Mention items (@ trigger) ─────────────────────────────────────────────────

export type MentionKind = 'file' | 'issue' | 'symbol' | 'custom';

export interface MentionItem {
  /** Stable unique identifier (e.g. a file path or issue identifier). */
  id: string;
  /** Text displayed in the popup and serialized as `@label` in the prompt. */
  label: string;
  /** Semantic category used for rendering (icon, chip colour, etc.). */
  kind: MentionKind;
  /** Optional secondary description shown in the popup row. */
  description?: string;
}

// ── Command items (/ trigger) ─────────────────────────────────────────────────

/** 'insert' → insert a /token node into the doc; 'execute' → run a side-effect and clear the trigger. */
export type CommandBehavior = 'insert' | 'execute';

export interface CommandItem {
  id: string;
  /** Short display name (no leading slash). */
  name: string;
  /** Text displayed in the popup. Defaults to name if omitted. */
  label?: string;
  description?: string;
  behavior: CommandBehavior;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PromptEditorRef {
  /** Focus the editor. */
  focus(): void;
  /** Clear all content. */
  clear(): void;
  /** Read the current serialized plain text. */
  getText(): string;
}

export interface PromptEditorProps {
  /** Controlled placeholder text when the editor is empty. */
  placeholder?: string;
  /** Whether the editor is disabled (read-only, no input). */
  disabled?: boolean;
  /** Called with the serialized plain-text value on every change. */
  onChange?: (text: string) => void;
  /** Called when the user submits (Enter with no open suggestion). */
  onSubmit?: (text: string) => void;
  /**
   * Async callback that returns @ mention suggestions for the given query.
   * Return an empty array if no suggestions are available.
   */
  queryMentions?: (query: string) => Promise<MentionItem[]>;
  /**
   * Async callback that returns / command suggestions for the given query.
   * Return an empty array if no commands are available.
   */
  queryCommands?: (query: string) => Promise<CommandItem[]>;
  /**
   * Called when a / command with behavior='execute' is selected.
   * The trigger range is deleted; text is NOT inserted.
   */
  onCommand?: (item: CommandItem) => void;
  className?: string;
}
