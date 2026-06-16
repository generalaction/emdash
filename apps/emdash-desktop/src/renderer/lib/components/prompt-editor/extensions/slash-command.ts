/**
 * / command extension.
 *
 * Reuses the Mention node infrastructure from @tiptap/extension-mention under a
 * different node name (`slashCommand`) and trigger char (`/`).
 *
 * Two behaviors (determined per-item):
 *  - 'insert'  → inserts a slashCommand atom node serialized as `/${name}`.
 *  - 'execute' → calls onCommand(item) and removes the trigger range without
 *                inserting any node.
 */

import { Mention as TipTapMention } from '@tiptap/extension-mention';
import { PluginKey } from '@tiptap/pm/state';
import type { SuggestionOptions } from '@tiptap/suggestion';
import type { CommandItem } from '../types';

const slashCommandPluginKey = new PluginKey('slashCommand');

export function buildSlashCommandExtension(
  suggestion: Partial<SuggestionOptions<CommandItem, any>>,
  onExecute: (item: CommandItem) => void
) {
  return TipTapMention.extend({
    name: 'slashCommand',
    addAttributes() {
      return {
        id: { default: null },
        name: { default: null },
      };
    },
  }).configure({
    HTMLAttributes: { class: 'slash-command-chip' },
    renderText({ node }) {
      return `/${(node.attrs.name as string | null) ?? (node.attrs.id as string | null) ?? ''}`;
    },
    renderHTML({ node }) {
      return [
        'span',
        {
          'data-type': 'slash-command',
          'data-id': node.attrs.id as string,
          'data-name': node.attrs.name as string,
          class: 'slash-command-chip',
        },
        `/${(node.attrs.name as string | null) ?? (node.attrs.id as string | null) ?? ''}`,
      ];
    },
    suggestion: {
      char: '/',
      allowSpaces: false,
      pluginKey: slashCommandPluginKey,
      // Wrap the command handler so 'execute' items don't insert a node.
      command({ editor, range, props }) {
        // TipTap types `props` as MentionNodeAttrs; cast to CommandItem since we control what gets passed.
        const item = props as unknown as CommandItem;
        if (item.behavior === 'execute') {
          editor.chain().focus().deleteRange(range).run();
          onExecute(item);
        } else {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContentAt(range.from, [
              {
                type: 'slashCommand',
                attrs: { id: item.id, name: item.name ?? item.id },
              },
              { type: 'text', text: ' ' },
            ])
            .run();
        }
      },
      ...(suggestion as Partial<SuggestionOptions<any, any>>),
    },
  });
}
