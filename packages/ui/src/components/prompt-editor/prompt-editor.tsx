/**
 * PromptEditor
 *
 * A TipTap (ProseMirror) based prompt input that supports:
 *  - Inline @ mention chips (inserted as atomic nodes, serialized as @label).
 *  - Inline / command chips (insert) or executed side-effects (execute).
 *  - Auto-growing height up to a CSS max-height with scroll overflow.
 *  - Copyable as plain text (mentions/commands flatten to @label / /name).
 *  - Enter to submit (when no suggestion open); Shift+Enter for hard break.
 *
 * Data sources are injected as async callbacks so the component is agnostic
 * to where mentions and commands come from.
 */

import { Placeholder } from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { buildMentionExtension } from './extensions/mention';
import { buildSlashCommandExtension } from './extensions/slash-command';
import { buildSubmitKeymap } from './extensions/submit-keymap';
import { serializeDoc } from './serialize';
import {
  SuggestionPopup,
  type SuggestionPopupHandle,
  type SuggestionItem,
} from './suggestion-popup';
import type { CommandItem, MentionItem, PromptEditorProps, PromptEditorRef } from './types';

/** Internal state tracked by each suggestion render lifecycle. */
interface SuggestionState {
  items: SuggestionItem[];
  rect: DOMRect | null;
  onSelect: (item: SuggestionItem) => void;
}

const EMPTY_SUGGESTION: SuggestionState = {
  items: [],
  rect: null,
  onSelect: () => {},
};

/**
 * Build the `render` factory required by @tiptap/suggestion.
 * We use `any` for the generic params because the popup only needs
 * `items`, `clientRect`, and the `command` callback — all of which
 * are invariant regardless of whether we're rendering mentions or commands.
 */
function makeSuggestionRender(
  setSuggestion: React.Dispatch<React.SetStateAction<SuggestionState>>,
  popupRef: React.RefObject<SuggestionPopupHandle | null>
): () => {
  onStart?: (props: SuggestionProps<any, any>) => void;
  onUpdate?: (props: SuggestionProps<any, any>) => void;
  onExit?: () => void;
  onKeyDown?: (props: SuggestionKeyDownProps) => boolean;
} {
  return () => ({
    onStart(props: SuggestionProps<any, any>) {
      setSuggestion({
        items: props.items as SuggestionItem[],
        rect: props.clientRect?.() ?? null,
        onSelect: (item) => props.command(item),
      });
    },
    onUpdate(props: SuggestionProps<any, any>) {
      setSuggestion({
        items: props.items as SuggestionItem[],
        rect: props.clientRect?.() ?? null,
        onSelect: (item) => props.command(item),
      });
    },
    onExit() {
      setSuggestion(EMPTY_SUGGESTION);
    },
    onKeyDown({ event }: SuggestionKeyDownProps) {
      return popupRef.current?.onKeyDown(event) ?? false;
    },
  });
}

export const PromptEditor = forwardRef<PromptEditorRef, PromptEditorProps>(function PromptEditor(
  {
    placeholder = 'Message…',
    disabled = false,
    onChange,
    onSubmit,
    queryMentions,
    queryCommands,
    onCommand,
    className,
  },
  ref
) {
  // Stable refs so callbacks inside TipTap extensions always see current values.
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  const queryMentionsRef = useRef(queryMentions);
  queryMentionsRef.current = queryMentions;
  const queryCommandsRef = useRef(queryCommands);
  queryCommandsRef.current = queryCommands;

  // Separate suggestion state for @ and / so they don't conflict.
  const [mentionSuggestion, setMentionSuggestion] = useState<SuggestionState>(EMPTY_SUGGESTION);
  const [commandSuggestion, setCommandSuggestion] = useState<SuggestionState>(EMPTY_SUGGESTION);
  const mentionPopupRef = useRef<SuggestionPopupHandle | null>(null);
  const commandPopupRef = useRef<SuggestionPopupHandle | null>(null);

  // We capture the editor in a stable ref so the submit handler can read the doc.
  const editorRef = useRef<ReturnType<typeof useEditor> | null>(null);

  // Stable submit callback that reads the doc from the current editor.
  const handleSubmitFromKeymap = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const text = serializeDoc(ed.state.doc);
    if (!text.trim()) return;
    ed.commands.clearContent(true);
    onSubmitRef.current?.(text);
  }, []);

  const mentionExtension = buildMentionExtension({
    items: async ({ query }: { query: string }) => (await queryMentionsRef.current?.(query)) ?? [],
    render: makeSuggestionRender(setMentionSuggestion, mentionPopupRef),
    command({ editor, range, props }) {
      const item = props as unknown as MentionItem;
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContentAt(range.from, [
          { type: 'mention', attrs: { id: item.id, label: item.label, kind: item.kind } },
          { type: 'text', text: ' ' },
        ])
        .run();
    },
  });

  const slashExtension = buildSlashCommandExtension(
    {
      items: async ({ query }: { query: string }) =>
        (await queryCommandsRef.current?.(query)) ?? [],
      render: makeSuggestionRender(setCommandSuggestion, commandPopupRef),
    },
    (item: CommandItem) => {
      onCommandRef.current?.(item);
    }
  );

  const submitKeymap = buildSubmitKeymap(handleSubmitFromKeymap);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable block-level nodes we don't need for a chat input.
        heading: false,
        blockquote: false,
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        horizontalRule: false,
      }),
      Placeholder.configure({ placeholder }),
      mentionExtension,
      slashExtension,
      submitKeymap,
    ],
    editorProps: {
      attributes: {
        class: cn(
          'prompt-editor-content outline-none text-sm text-foreground min-h-[36px]',
          'placeholder:text-foreground-passive'
        ),
        'data-testid': 'prompt-editor',
      },
      clipboardTextSerializer: (slice) => {
        const parts: string[] = [];
        slice.content.forEach((node) => {
          if (node.type.name === 'mention') {
            const label =
              (node.attrs.label as string | null) ?? (node.attrs.id as string | null) ?? '';
            parts.push(`@${label}`);
          } else if (node.type.name === 'slashCommand') {
            const name =
              (node.attrs.name as string | null) ?? (node.attrs.id as string | null) ?? '';
            parts.push(`/${name}`);
          } else if (node.type.name === 'hardBreak') {
            parts.push('\n');
          } else {
            parts.push(node.textContent);
          }
        });
        return parts.join('');
      },
    },
    onUpdate({ editor: e }) {
      const text = serializeDoc(e.state.doc);
      onChange?.(text);
    },
    editable: !disabled,
  });

  // Keep stable ref to editor.
  editorRef.current = editor;

  useImperativeHandle(ref, () => ({
    focus() {
      editor?.commands.focus();
    },
    clear() {
      editor?.commands.clearContent(true);
    },
    getText() {
      if (!editor) return '';
      return serializeDoc(editor.state.doc);
    },
  }));

  // Active suggestion = whichever is non-empty (only one at a time).
  const activeSuggestion =
    mentionSuggestion.items.length > 0
      ? mentionSuggestion
      : commandSuggestion.items.length > 0
        ? commandSuggestion
        : null;
  const activePopupRef = mentionSuggestion.items.length > 0 ? mentionPopupRef : commandPopupRef;

  return (
    <>
      <EditorContent editor={editor} className={cn('w-full', className)} aria-disabled={disabled} />
      {activeSuggestion &&
        createPortal(
          <SuggestionPopup
            ref={activePopupRef}
            items={activeSuggestion.items}
            rect={activeSuggestion.rect}
            onSelect={activeSuggestion.onSelect}
          />,
          document.body
        )}
    </>
  );
});
