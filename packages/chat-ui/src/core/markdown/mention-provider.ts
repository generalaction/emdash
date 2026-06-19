/**
 * MentionProvider — synchronous metadata resolver for @-mention tokens.
 *
 * The ChatComposer serializes mention nodes to plain `@label` text, so by the
 * time chat-ui parses the message the rich metadata (id, kind, name) is gone.
 * A MentionProvider re-resolves that metadata from the token string at parse
 * time, enabling chat-ui to render mentions as composer-style pills.
 *
 * The provider MUST be synchronous and stable for the lifetime of the ChatRoot
 * mount. Changing the provider requires a remount (same contract as the
 * `highlighter` option). When no provider is supplied the parser leaves @token
 * text as plain InlineText (today's behavior, no regression).
 */

/** Semantic category for a resolved context mention. Mirrors the composer's MentionKind. */
export type ChatMentionKind = 'file' | 'issue' | 'symbol' | 'custom';

/** Resolved metadata for a single mention token. */
export interface ChatMentionMeta {
  /** Stable unique identifier (e.g. a file path or issue id). */
  id: string;
  /** The raw @-label text that was matched in the message. */
  label: string;
  /** Short display name shown inside the rendered pill. Defaults to label. */
  name?: string;
  /** Semantic category for icon and chip color. */
  kind: ChatMentionKind;
  /**
   * Optional CSS class for the pill icon (e.g. a devicon class like
   * `devicon-react-original colored`). When supplied it is rendered as an
   * `<i class={iconClass}>` to match a host icon set exactly; otherwise the
   * built-in kind SVG is used.
   */
  iconClass?: string;
}

/**
 * Injectable provider that resolves a raw @-mention token (the text after '@')
 * to rich metadata for display purposes.
 *
 * Must be synchronous — called during the markdown parse phase which runs
 * inline within virtualizer measurement.
 */
export interface MentionProvider {
  /**
   * Resolve the token string (everything after '@') to metadata.
   * Return null if the token is not a known mention (treated as plain text).
   */
  resolve(token: string): ChatMentionMeta | null;
}
