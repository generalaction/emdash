/**
 * Serialize a TipTap/ProseMirror document to plain text.
 *
 * Rules:
 *  - `mention` node   → `@${node.attrs.label ?? node.attrs.id}`
 *  - `slashCommand` node → `/${node.attrs.name ?? node.attrs.id}`
 *  - `hardBreak` node → `\n`
 *  - paragraph boundary → `\n` between paragraphs (but NOT trailing)
 *  - all other inline nodes / marks → plain text content
 */

import type { Node } from '@tiptap/pm/model';

function serializeNode(node: Node): string {
  if (node.type.name === 'mention') {
    const label = (node.attrs.label as string | null) ?? (node.attrs.id as string | null) ?? '';
    return `@${label}`;
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
