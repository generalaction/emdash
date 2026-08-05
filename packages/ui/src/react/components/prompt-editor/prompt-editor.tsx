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
 * to where mentions and commands come from. Prefer `mentionProvider` over
 * `queryMentions` for new integrations.
 */

import { cx } from '@styles/utilities/cx';
import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { AtSign, Braces, CircleDot, File } from 'lucide-react';
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import {
  ComboboxPopup,
  type ComboboxPopupHandle,
  type ComboboxPopupItem,
} from '../../primitives/combobox/combobox-popup';
import { buildMentionExtension } from './extensions/mention';
import { buildSlashCommandExtension } from './extensions/slash-command';
import { buildSubmitKeymap } from './extensions/submit-keymap';
import { fileIconClass } from './mention-pill-helpers';
import { serializeDoc, serializeNode } from './serialize';
import type {
  CommandItem,
  MentionItem,
  MentionKind,
  PromptEditorProps,
  PromptEditorRef,
} from './types';
import * as styles from './prompt-editor.css';

// ── Icon helpers for the popup ────────────────────────────────────────────────

const ICON_SIZE_MD = { width: '0.875rem', height: '0.875rem' };

const KIND_POPUP_ICONS: Record<MentionKind, React.ReactNode> = {
  file: <File style={ICON_SIZE_MD} />,
  issue: <CircleDot style={ICON_SIZE_MD} />,
  symbol: <Braces style={ICON_SIZE_MD} />,
  custom: <AtSign style={ICON_SIZE_MD} />,
};

function mentionToPopupItem(item: MentionItem): ComboboxPopupItem {
  let icon: React.ReactNode = item.icon;
  if (!icon) {
    if (item.kind === 'file') {
      const cls = fileIconClass(item.label);
      icon = cls ? (
        <i className={cls} style={{ fontSize: '13px', lineHeight: 1 }} />
      ) : (
        KIND_POPUP_ICONS.file
      );
    } else {
      icon = KIND_POPUP_ICONS[item.kind] ?? KIND_POPUP_ICONS.custom;
    }
  }
  return {
    id: item.id,
    icon,
    label: item.name ?? item.label,
    description: item.description ?? (item.name ? item.label : undefined),
  };
}

function commandToPopupItem(item: CommandItem): ComboboxPopupItem {
  // Command entries are slash-prefixed; raw prompt entries keep their title.
  const label =
    item.behavior === 'insert-text'
      ? (item.label ?? item.name)
      : `/${item.name.replace(/^\/+/, '')}`;
  return {
    id: item.id,
    label,
    description: item.description,
    section: item.section,
  };
}

// ── Internal state tracked by each suggestion render lifecycle ────────────────

interface SuggestionState<T> {
  items: T[];
  rect: DOMRect | null;
  onSelect: (item: T) => void;
}

function emptySuggestion<T>(): SuggestionState<T> {
  return { items: [], rect: null, onSelect: () => {} };
}

/**
 * Build the `render` factory required by @tiptap/suggestion.
 * We rely on SuggestionProps' default generics because the popup only needs
 * `items`, `clientRect`, and the `command` callback — all of which
 * are invariant regardless of whether we're rendering mentions or commands.
 */
function makeSuggestionRender<T>(
  setSuggestion: React.Dispatch<React.SetStateAction<SuggestionState<T>>>,
  popupRef: React.RefObject<ComboboxPopupHandle | null>
): () => {
  onStart?: (props: SuggestionProps) => void;
  onUpdate?: (props: SuggestionProps) => void;
  onExit?: () => void;
  onKeyDown?: (props: SuggestionKeyDownProps) => boolean;
} {
  return () => ({
    onStart(props: SuggestionProps) {
      setSuggestion({
        items: props.items as T[],
        rect: props.clientRect?.() ?? null,
        onSelect: (item) => props.command(item),
      });
    },
    onUpdate(props: SuggestionProps) {
      setSuggestion({
        items: props.items as T[],
        rect: props.clientRect?.() ?? null,
        onSelect: (item) => props.command(item),
      });
    },
    onExit() {
      setSuggestion(emptySuggestion());
    },
    onKeyDown({ event }: SuggestionKeyDownProps) {
      return popupRef.current?.onKeyDown(event) ?? false;
    },
  });
}

function plainTextDoc(text: string) {
  const lines = text.length > 0 ? text.split(/\r?\n/) : [''];
  return {
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      ...(line.length > 0 ? { content: [{ type: 'text', text: line }] } : {}),
    })),
  };
}

function mentionInsertContent(item: MentionItem) {
  return [
    {
      type: 'mention',
      attrs: {
        id: item.id,
        label: item.label,
        name: item.name ?? null,
        kind: item.kind,
        pending: item.pending ?? false,
      },
    },
    { type: 'text', text: ' ' },
  ];
}

// ── Component ─────────────────────────────────────────────────────────────────

export const PromptEditor = forwardRef<PromptEditorRef, PromptEditorProps>(function PromptEditor(
  {
    placeholder = 'Message…',
    disabled = false,
    onChange,
    onSubmit,
    onMentionInsert,
    mentionProvider,
    renderMentionIcon,
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
  const onMentionInsertRef = useRef(onMentionInsert);
  onMentionInsertRef.current = onMentionInsert;
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  const mentionProviderRef = useRef(mentionProvider);
  mentionProviderRef.current = mentionProvider;
  const renderMentionIconRef = useRef(renderMentionIcon);
  renderMentionIconRef.current = renderMentionIcon;
  const queryMentionsRef = useRef(queryMentions);
  queryMentionsRef.current = queryMentions;
  const queryCommandsRef = useRef(queryCommands);
  queryCommandsRef.current = queryCommands;

  // Separate suggestion state for @ and / so they don't conflict.
  const [isEmpty, setIsEmpty] = useState(true);
  const [mentionSuggestion, setMentionSuggestion] =
    useState<SuggestionState<MentionItem>>(emptySuggestion());
  const [commandSuggestion, setCommandSuggestion] =
    useState<SuggestionState<CommandItem>>(emptySuggestion());
  const mentionPopupRef = useRef<ComboboxPopupHandle | null>(null);
  const commandPopupRef = useRef<ComboboxPopupHandle | null>(null);

  // We capture the editor in a stable ref so the submit handler can read the doc.
  const editorRef = useRef<ReturnType<typeof useEditor> | null>(null);

  // Stable submit callback that reads the doc from the current editor.
  const handleSubmitFromKeymap = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const text = serializeDoc(ed.state.doc);
    if (!text.trim()) return;
    if (!onSubmitRef.current) return;
    ed.commands.clearContent(true);
    onSubmitRef.current(text);
  }, []);

  const mentionExtension = buildMentionExtension(
    {
      items: async ({ query }: { query: string }) => {
        // Prefer mentionProvider over the legacy queryMentions callback.
        const provider = mentionProviderRef.current;
        if (provider) return provider.search(query);
        return (await queryMentionsRef.current?.(query)) ?? [];
      },
      render: makeSuggestionRender<MentionItem>(setMentionSuggestion, mentionPopupRef),
      command({ editor, range, props }) {
        const item = props as unknown as MentionItem;
        if (item.insertText !== undefined) {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContentAt(range.from, item.insertText)
            .insertContent(' ')
            .run();
          return;
        }
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContentAt(range.from, mentionInsertContent(item))
          .run();
        onMentionInsertRef.current?.(item);
      },
    },
    {
      renderMentionIcon: (attrs) => renderMentionIconRef.current?.(attrs) ?? null,
    }
  );

  const slashExtension = buildSlashCommandExtension(
    {
      items: async ({ query }: { query: string }) =>
        (await queryCommandsRef.current?.(query)) ?? [],
      render: makeSuggestionRender<CommandItem>(setCommandSuggestion, commandPopupRef),
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
      mentionExtension,
      slashExtension,
      submitKeymap,
    ],
    editorProps: {
      attributes: {
        class: cx('prompt-editor-content', styles.promptEditorContentClass),
        'data-testid': 'prompt-editor',
      },
      clipboardTextSerializer: (slice) => {
        // Use serializeNode so mentions/commands within paragraphs are included
        // as @label / /name even when the React NodeView renders them as complex DOM.
        const parts: string[] = [];
        slice.content.forEach((node) => parts.push(serializeNode(node)));
        return parts.join('\n').replace(/\n+$/, '');
      },
    },
    onUpdate({ editor: e }) {
      setIsEmpty(e.isEmpty);
      const text = serializeDoc(e.state.doc);
      onChange?.(text);
    },
    editable: !disabled,
  });

  // Keep stable ref to editor.
  editorRef.current = editor;

  useImperativeHandle(ref, () => ({
    focus(options) {
      editor?.commands.focus(undefined, options);
    },
    clear() {
      editor?.commands.clearContent(true);
    },
    getText() {
      if (!editor) return '';
      return serializeDoc(editor.state.doc);
    },
    setText(text) {
      editor?.commands.setContent(plainTextDoc(text), { emitUpdate: true });
    },
    insertMention(item) {
      if (item.insertText !== undefined) {
        editor?.chain().focus().insertContent(item.insertText).insertContent(' ').run();
        return;
      }
      editor?.chain().focus().insertContent(mentionInsertContent(item)).run();
      onMentionInsertRef.current?.(item);
    },
    prependMention(item) {
      if (!editor || item.insertText !== undefined) return;
      const tr = editor.state.tr;
      const ranges: Array<{ from: number; to: number }> = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'mention' || node.attrs.id !== item.id) return;
        ranges.push({ from: pos, to: pos + node.nodeSize });
      });
      for (const range of [...ranges].reverse()) {
        tr.delete(range.from, range.to);
      }
      if (ranges.length > 0) editor.view.dispatch(tr);
      editor.commands.insertContentAt(1, mentionInsertContent(item));
    },
    removeMention(id) {
      if (!editor) return;
      const tr = editor.state.tr;
      const ranges: Array<{ from: number; to: number }> = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'mention' || node.attrs.id !== id) return;
        ranges.push({ from: pos, to: pos + node.nodeSize });
      });
      if (ranges.length === 0) return;
      for (const range of [...ranges].reverse()) {
        tr.delete(range.from, range.to);
      }
      editor.view.dispatch(tr);
    },
    setMentionPending(id, pending) {
      if (!editor) return;
      let changed = false;
      const tr = editor.state.tr;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'mention' || node.attrs.id !== id) return;
        if (node.attrs.pending === pending) return;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, pending });
        changed = true;
      });
      if (changed) editor.view.dispatch(tr);
    },
  }));

  // Convert suggestion items to ComboboxPopupItem shape.
  const mentionPopupItems = mentionSuggestion.items.map(mentionToPopupItem);
  const commandPopupItems = commandSuggestion.items.map(commandToPopupItem);

  const mentionActive = mentionSuggestion.items.length > 0;
  const commandActive = commandSuggestion.items.length > 0;

  return (
    <>
      <div className={cx(styles.editorWrapper, className)}>
        <EditorContent editor={editor} className={styles.editorContent} aria-disabled={disabled} />
        {isEmpty && (
          <span aria-hidden className={styles.editorPlaceholder}>
            {placeholder}
          </span>
        )}
      </div>
      {mentionActive &&
        createPortal(
          <ComboboxPopup
            ref={mentionPopupRef}
            items={mentionPopupItems}
            anchorRect={mentionSuggestion.rect}
            onSelect={(popupItem) => {
              const original = mentionSuggestion.items.find((m) => m.id === popupItem.id);
              if (original) mentionSuggestion.onSelect(original);
            }}
          />,
          document.body
        )}
      {commandActive &&
        createPortal(
          <ComboboxPopup
            ref={commandPopupRef}
            items={commandPopupItems}
            anchorRect={commandSuggestion.rect}
            stacked
            onSelect={(popupItem) => {
              const original = commandSuggestion.items.find((c) => c.id === popupItem.id);
              if (original) commandSuggestion.onSelect(original);
            }}
          />,
          document.body
        )}
    </>
  );
});
