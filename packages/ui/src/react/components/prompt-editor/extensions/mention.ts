/**
 * @ mention extension.
 *
 * Produces atomic inline `mention` nodes with attrs { id, label, name, kind }.
 *  - `id`    – stable identifier (e.g. file path).
 *  - `label` – full-path text serialized as `@label` in clipboard/plain text.
 *  - `name`  – short display name shown inside the pill (basename by default).
 *  - `kind`  – semantic category (file | issue | symbol | custom).
 *
 * The pill visual is rendered by MentionPill via ReactNodeViewRenderer.
 * Serializes to `@label` for bare-safe labels, or `@"label"` for file mentions
 * whose path contains spaces or other characters outside the tokenizer's char class.
 *
 * The actual popup rendering is handled externally via the `suggestion.render`
 * callback injected by PromptEditor.
 */

import { Mention as TipTapMention } from '@tiptap/extension-mention';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { SuggestionOptions } from '@tiptap/suggestion';
import { MentionPill } from '../mention-pill';
import { serializeMentionLabel } from '../serialize';
import type { MentionItem } from '../types';

export function buildMentionExtension(
  // Use `any` for the Selected generic so our richer MentionItem attrs don't conflict
  // with TipTap's narrower built-in MentionNodeAttrs type.
  suggestion: Partial<SuggestionOptions<MentionItem, any>>
) {
  return TipTapMention.extend({
    name: 'mention',
    inline: true,
    group: 'inline',
    atom: true,
    addAttributes() {
      return {
        id: { default: null },
        label: { default: null },
        name: { default: null },
        kind: { default: 'custom' },
      };
    },
    addNodeView() {
      return ReactNodeViewRenderer(MentionPill, { as: 'span' });
    },
  }).configure({
    HTMLAttributes: { class: 'mention-chip' },
    renderText({ node }) {
      const label =
        (node.attrs.label as string | null) ?? (node.attrs.id as string | null) ?? '';
      return serializeMentionLabel(label, node.attrs.kind as string | null);
    },
    renderHTML({ node }) {
      const label =
        (node.attrs.label as string | null) ?? (node.attrs.id as string | null) ?? '';
      return [
        'span',
        {
          'data-type': 'mention',
          'data-id': node.attrs.id as string,
          'data-label': node.attrs.label as string,
          'data-name': (node.attrs.name as string | null) ?? '',
          'data-kind': node.attrs.kind as string,
          class: 'mention-chip',
        },
        serializeMentionLabel(label, node.attrs.kind as string | null),
      ];
    },
    // Cast to `any` to bypass the MentionNodeAttrs constraint; we control the attrs shape.
    suggestion: {
      char: '@',
      allowSpaces: false,
      ...(suggestion as Partial<SuggestionOptions<any, any>>),
    },
  });
}
