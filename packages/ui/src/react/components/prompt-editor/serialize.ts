/**
 * Serialize a TipTap/ProseMirror document to plain text.
 *
 * Rules:
 *  - `mention` node   → `@${label}` or `@"${label}"` for file mentions with unsafe chars
 *  - `slashCommand` node → `/${node.attrs.name ?? node.attrs.id}`
 *  - `hardBreak` node → `\n`
 *  - paragraph boundary → `\n` between paragraphs (but NOT trailing)
 *  - all other inline nodes / marks → plain text content
 */

import type { Node } from '@tiptap/pm/model';

/**
 * Mirrors the character class of chat-ui's AT_TOKEN_RE. A label is "bare-safe"
 * when every character is in the tokenizer's allowed set and it doesn't end with
 * a dot (the tokenizer drops a trailing sentence-final dot).
 */
const BARE_TOKEN_SAFE_RE = /^[\w/\-:().]+$/;

/**
 * Serialize a mention label to its `@...` text form.
 *
 * For `file` mentions whose label contains spaces or other special characters
 * that the transcript tokenizer cannot parse as a bare `@token`, emit a quoted
 * form `@"<label>"` instead. All other mentions use the bare `@<label>` form.
 *
 * The quoted form is also what the agent receives on submit, so agents see
 * `@"abs path"` for file paths with spaces — a conventional, unambiguous style.
 */
export function serializeMentionLabel(label: string, kind: string | null): string {
  const bareSafe = BARE_TOKEN_SAFE_RE.test(label) && !label.endsWith('.');
  if (kind === 'file' && !bareSafe) return `@"${label}"`;
  return `@${label}`;
}

/**
 * Serialize a single ProseMirror node to its plain-text representation.
 * Exported so that `clipboardTextSerializer` (and other callers) can reuse it
 * without going through `serializeDoc`, which expects a full document root.
 */
export function serializeNode(node: Node): string {
  if (node.type.name === 'mention') {
    const label = (node.attrs.label as string | null) ?? (node.attrs.id as string | null) ?? '';
    return serializeMentionLabel(label, node.attrs.kind as string | null);
  }

  if (node.type.name === 'slashCommand') {
    const name = (node.attrs.name as string | null) ?? (node.attrs.id as string | null) ?? '';
    return `/${name}`;
  }

  if (node.type.name === 'hardBreak') {
    return '\n';
  }

  if (node.isText) {
    return node.text ?? '';
  }

  // Recurse into block/inline containers
  const parts: string[] = [];
  node.forEach((child) => {
    parts.push(serializeNode(child));
  });
  return parts.join('');
}

/**
 * Serialize the whole editor document to a plain-text string.
 * Paragraphs are joined by a single newline; trailing newline is trimmed.
 */
export function serializeDoc(doc: Node): string {
  const paragraphs: string[] = [];

  doc.forEach((block) => {
    const parts: string[] = [];
    block.forEach((child) => {
      parts.push(serializeNode(child));
    });
    paragraphs.push(parts.join(''));
  });

  // Join paragraphs with newlines, collapse trailing blank lines
  return paragraphs.join('\n').replace(/\n+$/, '');
}
