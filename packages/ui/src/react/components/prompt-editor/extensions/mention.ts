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
 * Serializes to `@label` for both clipboard and text export.
 *
 * The actual popup rendering is handled externally via the `suggestion.render`
 * callback injected by PromptEditor.
 */

import { Mention as TipTapMention } from '@tiptap/extension-mention';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { SuggestionOptions } from '@tiptap/suggestion';
import { MentionPill } from '../mention-pill';
import type { MentionItem } from '../types';

export function buildMentionExtension(
  // Use `any` for the Selected generic so our richer MentionItem attrs don't conflict
  // with TipTap's narrower built-in MentionNodeAttrs type.
  // oxlint-disable-next-line typescript/no-explicit-any -- TipTap constrains this to MentionNodeAttrs internally.
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
      return `@${(node.attrs.label as string | null) ?? (node.attrs.id as string | null) ?? ''}`;
    },
    renderHTML({ node }) {
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
        `@${(node.attrs.label as string | null) ?? (node.attrs.id as string | null) ?? ''}`,
      ];
    },
    // Cast to bypass the MentionNodeAttrs constraint; we control the attrs shape.
    suggestion: {
      char: '@',
      allowSpaces: false,
      // oxlint-disable-next-line typescript/no-explicit-any -- We control the mention attrs shape.
      ...(suggestion as Partial<SuggestionOptions<any, any>>),
    },
  });
}
