/**
 * Keymap extension:
 *  - Enter (no modifier) → submit.
 *    When a suggestion popup is active the suggestion plugin intercepts Enter
 *    first (returning `true`) so this handler only fires when no popup is open.
 *  - Shift+Enter → insert a hard break.
 */

import { Extension } from '@tiptap/core';

export function buildSubmitKeymap(onSubmit: () => void) {
  return Extension.create({
    name: 'submitKeymap',
    addKeyboardShortcuts() {
      return {
        Enter: () => {
          onSubmit();
          return true;
        },

        'Shift-Enter': ({ editor }) => {
          editor.commands.setHardBreak();
          return true;
        },
      };
    },
  });
}
