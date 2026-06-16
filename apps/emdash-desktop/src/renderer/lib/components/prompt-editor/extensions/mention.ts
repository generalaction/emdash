/**
 * @ mention extension.
 *
 * Produces atomic inline `mention` nodes with attrs { id, label, kind }.
 * Serializes to `@label` for both clipboard and text export.
 *
 * The actual popup rendering is handled externally via the `suggestion.render`
 * callback injected by PromptEditor.
 */

import { Mention as TipTapMention } from '@tiptap/extension-mention';
import type { SuggestionOptions } from '@tiptap/suggestion';
import type { MentionItem } from '../types';

export function buildMentionExtension(
  // Use `any` for the Selected generic so our richer MentionItem attrs don't conflict
  // with TipTap's narrower built-in MentionNodeAttrs type.
  suggestion: Partial<SuggestionOptions<MentionItem, any>>
) {
  return TipTapMention.extend({
    name: 'mention',
    addAttributes() {
      return {
        id: { default: null },
        label: { default: null },
        kind: { default: 'custom' },
      };
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
          'data-kind': node.attrs.kind as string,
          class: 'mention-chip',
        },
        `@${(node.attrs.label as string | null) ?? (node.attrs.id as string | null) ?? ''}`,
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
