/**
 * Public types for the PromptEditor component.
 * Keep this file dependency-free (no TipTap imports) so consumers can type-check
 * without pulling the whole editor bundle.
 */

import type { ReactNode } from 'react';

// ── Mention items (@ trigger) ─────────────────────────────────────────────────

export type MentionKind = 'file' | 'issue' | 'symbol' | 'custom';

export interface MentionItem {
  /** Stable unique identifier (e.g. a file path or issue identifier). */
  id: string;
  /**
   * Serialization label — written as `@label` in clipboard / plain-text output.
   * Typically the full path for files.
   */
  label: string;
  /** Semantic category used for rendering (icon, chip colour, etc.). */
  kind: MentionKind;
  /**
   * Short display name shown inside the inline pill.
   * Defaults to the basename of `label` when not provided.
   */
  name?: string;
  /**
   * Optional icon rendered in the suggestion popup (not in the pill — the pill
   * derives its icon from `kind`/`label`). Pass a React element, e.g. a lucide icon.
   */
  icon?: ReactNode;
  /** Optional secondary description shown in the popup row. */
  description?: string;
}

// ── Context mention provider ──────────────────────────────────────────────────

/**
 * Injectable provider that the host application wires to supply @ mention
 * suggestions. Prefer this over the lower-level `queryMentions` callback when
 * building a typed feature — it is easier to extend (group metadata, async
 * cancel, etc.) without breaking the component API.
 */
export interface ContextMentionProvider {
  /** Return suggestions matching the given partial query string. */
  search(query: string): Promise<MentionItem[]>;
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
  /** Imperatively insert a mention node at the current cursor position. */
  insertMention(item: MentionItem): void;
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
   * Preferred: typed provider for @ mention suggestions.
   * When both `mentionProvider` and `queryMentions` are provided,
   * `mentionProvider` takes precedence.
   */
  mentionProvider?: ContextMentionProvider;
  /**
   * Legacy: async callback that returns @ mention suggestions.
   * Kept for back-compat; prefer `mentionProvider` for new integrations.
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
