import { cx } from '@styles/utilities/cx';
import { Editor, type JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { StarterKit } from '@tiptap/starter-kit';
import type { SuggestionOptions } from '@tiptap/suggestion';
import { buildMentionExtension } from './extensions/mention';
import { buildSlashCommandExtension } from './extensions/slash-command';
import { buildSubmitKeymap } from './extensions/submit-keymap';
import { serializeDoc, serializeNode } from './serialize';
import type { MentionItem, PromptEditorProps, PromptEditorRef } from './types';
import * as styles from './prompt-editor.css';

type SuggestionRenderer = NonNullable<SuggestionOptions['render']>;

export interface PromptEditorSnapshot {
  readonly text: string;
  readonly isEmpty: boolean;
  /** Distinguishes successive DOM attachments of the same retained editor. */
  readonly viewId: number;
  /** Present only while a view is attached. */
  readonly editor: Editor | null;
}

/** One DOM attachment; its callbacks must not survive detachment. */
export interface PromptEditorView {
  readonly editor: Editor;
  readonly viewport: HTMLElement;
  options: PromptEditorProps;
  mentions: SuggestionRenderer;
  commands: SuggestionRenderer;
  ready: boolean;
  detach(): void;
}

/**
 * The single owner of a draft's document, selection and undo history.
 * Text is an observable projection, not a second input fed back into the editor.
 * Document commands work without a view; focus and viewport coordinates do not.
 */
export class PromptEditorModel implements PromptEditorRef {
  private editor: Editor | null = null;
  private initialDocument: JSONContent | null;
  private snapshot: PromptEditorSnapshot;
  private readonly listeners = new Set<() => void>();
  private mentionSignature: string;
  private attachmentVersion = 0;
  private scrollTop = 0;
  private scrollLeft = 0;
  private focusRequested = false;
  /** @internal The current view adapter; never the owner of draft state. */
  view: PromptEditorView | null = null;

  constructor({
    text = '',
    mentions = [],
  }: { text?: string; mentions?: readonly MentionItem[] } = {}) {
    this.initialDocument = plainTextDoc(text, mentions);
    this.mentionSignature = mentionSignature(mentions);
    this.snapshot = { text, isEmpty: text.length === 0, editor: null, viewId: 0 };
  }

  getSnapshot = (): PromptEditorSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** @internal Publish engine transactions to every owner, including while detached. */
  publish(): void {
    const text = this.editor ? serializeDoc(this.editor.state.doc) : this.snapshot.text;
    const isEmpty = this.editor ? this.editor.isEmpty : text.length === 0;
    const editor = this.view?.editor ?? null;
    if (
      text === this.snapshot.text &&
      isEmpty === this.snapshot.isEmpty &&
      editor === this.snapshot.editor &&
      this.attachmentVersion === this.snapshot.viewId
    )
      return;
    this.snapshot = { text, isEmpty, editor, viewId: this.attachmentVersion };
    this.listeners.forEach((listener) => listener());
  }

  private ensureEditor(): Editor {
    if (!this.editor) {
      this.editor = createEditor(this, this.initialDocument ?? plainTextDoc(''));
      this.initialDocument = null;
    }
    return this.editor;
  }

  attach(viewport: HTMLElement): PromptEditorView {
    if (this.view) throw new Error('Prompt editor model is already attached');
    this.attachmentVersion++;
    const editor = this.ensureEditor();
    const view: PromptEditorView = {
      editor,
      viewport,
      options: {},
      mentions: () => ({}),
      commands: () => ({}),
      ready: false,
      detach: () => this.detach(view),
    };
    this.view = view;
    editor.mount(document.createElement('div'));
    this.publish();
    return view;
  }

  /**
   * The React adapter calls this once per commit, after EditorContent initializes.
   * Controlled text synchronization exists only for legacy callers without a model.
   */
  commitView(
    options: PromptEditorProps,
    suggestions: Pick<PromptEditorView, 'mentions' | 'commands'>
  ): void {
    const view = this.view;
    if (!view) return;
    view.options = options;
    view.mentions = suggestions.mentions;
    view.commands = suggestions.commands;
    const editor = view.editor;
    if (editor.isEditable === !!options.disabled) editor.setEditable(!options.disabled, false);
    if (!options.model && options.value !== undefined) {
      const signature = mentionSignature(options.mentions);
      if (this.getText() !== options.value || signature !== this.mentionSignature) {
        this.mentionSignature = signature;
        const { anchor, head } = editor.state.selection;
        const focused = view.ready && editor.view.hasFocus();
        editor.commands.setContent(plainTextDoc(options.value, options.mentions), {
          emitUpdate: false,
        });
        const max = Math.max(1, editor.state.doc.content.size - 1);
        const clamp = (position: number) => Math.max(1, Math.min(position, max));
        editor.commands.setTextSelection({ from: clamp(anchor), to: clamp(head) });
        if (focused) editor.view.focus();
        this.publish();
      }
    }
    if (!view.ready && view.viewport.contains(editor.view.dom)) {
      view.ready = true;
      if (this.focusRequested) this.focus();
      view.viewport.scrollTop = this.scrollTop;
      view.viewport.scrollLeft = this.scrollLeft;
    }
  }

  private detach(view: PromptEditorView): void {
    if (this.view !== view) return;
    if (view.ready) {
      this.scrollTop = view.viewport.scrollTop;
      this.scrollLeft = view.viewport.scrollLeft;
    }
    this.view = null;
    void view.editor.state;
    view.editor.unmount();
    view.editor.setOptions({ element: null });
    view.options = {};
    view.mentions = view.commands = () => ({});
    this.publish();
  }

  suggestionRenderer(kind: 'mentions' | 'commands'): ReturnType<SuggestionRenderer> {
    const version = this.attachmentVersion;
    const current = () => (this.attachmentVersion === version ? this.view?.[kind]() : undefined);
    return {
      onStart: (props) => current()?.onStart?.(props),
      onUpdate: (props) => current()?.onUpdate?.(props),
      onExit: (props) => current()?.onExit?.(props),
      onKeyDown: (props) => current()?.onKeyDown?.(props) ?? false,
    };
  }

  focus(): void {
    this.focusRequested = !this.view?.ready;
    if (this.view?.ready) this.view.editor.view.focus();
  }

  getText(): string {
    return this.snapshot.text;
  }

  setText(text: string): void {
    if (text === this.getText()) return;
    if (this.editor) {
      this.editor.commands.setContent(plainTextDoc(text), { emitUpdate: true });
    } else {
      this.initialDocument = plainTextDoc(text);
      this.snapshot = {
        text,
        isEmpty: text.length === 0,
        editor: null,
        viewId: this.attachmentVersion,
      };
      this.listeners.forEach((listener) => listener());
    }
  }

  clear(): void {
    if (this.editor) this.editor.commands.clearContent(true);
    else this.setText('');
  }

  getSelection(): { from: number; to: number } {
    if (!this.editor) return { from: 0, to: 0 };
    const {
      doc,
      selection: { from, to },
    } = this.editor.state;
    return { from: serializedOffsetAtPosition(doc, from), to: serializedOffsetAtPosition(doc, to) };
  }

  getPositionAtCoordinates(coordinates: { left: number; top: number }): number | null {
    if (!this.view?.ready) return null;
    const { editor } = this.view;
    const result = editor.view.posAtCoords(coordinates);
    return result ? serializedOffsetAtPosition(editor.state.doc, result.pos) : null;
  }

  insertMention(item: MentionItem): void {
    const editor = this.ensureEditor();
    if (this.view?.ready) editor.view.focus();
    if (item.insertText !== undefined) {
      editor.chain().insertContent(item.insertText).insertContent(' ').run();
      return;
    }
    editor.commands.insertContent(mentionInsertContent(item));
    this.view?.options.onMentionInsert?.(item);
  }

  prependMention(item: MentionItem): void {
    if (item.insertText !== undefined) return;
    const editor = this.ensureEditor();
    this.removeMention(item.id);
    editor.commands.insertContentAt(1, mentionInsertContent(item));
  }

  removeMention(id: string): void {
    if (!this.editor) return;
    const tr = this.editor.state.tr;
    const ranges: Array<{ from: number; to: number }> = [];
    this.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'mention' && node.attrs.id === id)
        ranges.push({ from: pos, to: pos + node.nodeSize });
    });
    if (ranges.length === 0) return;
    for (const range of ranges.reverse()) tr.delete(range.from, range.to);
    this.editor.view.dispatch(tr);
  }

  setMentionPending(id: string, pending: boolean): void {
    if (!this.editor) return;
    let changed = false;
    const tr = this.editor.state.tr;
    this.editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'mention' || node.attrs.id !== id || node.attrs.pending === pending)
        return;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, pending });
      changed = true;
    });
    if (changed) this.editor.view.dispatch(tr);
  }

  dispose(): void {
    if (this.view) this.detach(this.view);
    this.editor?.destroy();
    this.editor = null;
    this.listeners.clear();
    this.initialDocument = plainTextDoc('');
    this.snapshot = { text: '', isEmpty: true, editor: null, viewId: this.attachmentVersion };
    this.scrollTop = this.scrollLeft = 0;
    this.focusRequested = false;
  }
}

function mentionNode(item: MentionItem): JSONContent {
  return {
    type: 'mention',
    attrs: {
      id: item.id,
      label: item.label,
      name: item.name ?? null,
      kind: item.kind,
      pending: item.pending ?? false,
      serializedText: item.serializedText ?? null,
    },
  };
}

function inlinePlainTextContent(text: string, mentions: readonly MentionItem[]): JSONContent[] {
  if (text.length === 0) return [];
  const candidates = mentions
    .map((item) => ({ item, token: item.serializedText ?? `@${item.label}` }))
    .sort((left, right) => right.token.length - left.token.length);
  const content: JSONContent[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let next: { item: MentionItem; token: string; index: number } | null = null;
    for (const candidate of candidates) {
      const index = text.indexOf(candidate.token, cursor);
      if (index < 0) continue;
      if (
        !next ||
        index < next.index ||
        (index === next.index && candidate.token.length > next.token.length)
      ) {
        next = { ...candidate, index };
      }
    }
    if (!next) {
      content.push({ type: 'text', text: text.slice(cursor) });
      break;
    }
    if (next.index > cursor) {
      content.push({ type: 'text', text: text.slice(cursor, next.index) });
    }
    content.push(mentionNode(next.item));
    cursor = next.index + next.token.length;
  }

  return content;
}

function plainTextDoc(text: string, mentions: readonly MentionItem[] = []): JSONContent {
  const lines = text.length > 0 ? text.split(/\r?\n/) : [''];
  return {
    type: 'doc',
    content: lines.map((line) => {
      const content = inlinePlainTextContent(line, mentions);
      return {
        type: 'paragraph',
        ...(content.length > 0 ? { content } : {}),
      };
    }),
  };
}

function serializedOffsetAtPosition(doc: ProseMirrorNode, position: number): number {
  const clamped = Math.max(0, Math.min(position, doc.content.size));
  return serializeDoc(doc.cut(0, clamped)).length;
}

function mentionInsertContent(item: MentionItem): JSONContent[] {
  return [mentionNode(item), { type: 'text', text: ' ' }];
}

function mentionSignature(mentions: PromptEditorProps['mentions']): string {
  return JSON.stringify(
    mentions?.map(({ id, kind, label, name, pending, serializedText }) => ({
      id,
      kind,
      label,
      name,
      pending,
      serializedText,
    })) ?? []
  );
}

function createEditor(model: PromptEditorModel, content: JSONContent): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        horizontalRule: false,
        link: { openOnClick: false },
      }),
      buildMentionExtension(
        {
          items: async ({ query }: { query: string }) => {
            const binding = model.view;
            const provider = binding?.options.mentionProvider;
            const items = await (provider
              ? provider.search(query)
              : binding?.options.queryMentions?.(query));
            return model.view === binding ? (items ?? []) : [];
          },
          render: () => model.suggestionRenderer('mentions'),
          command({ editor, range, props: suggestion }) {
            const item = suggestion as unknown as MentionItem;
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
            model.view?.options.onMentionInsert?.(item);
          },
        },
        { renderMentionIcon: (attrs) => model.view?.options.renderMentionIcon?.(attrs) ?? null }
      ),
      buildSlashCommandExtension(
        {
          items: async ({ query }: { query: string }) => {
            const binding = model.view;
            const items = await binding?.options.queryCommands?.(query);
            return model.view === binding ? (items ?? []) : [];
          },
          render: () => model.suggestionRenderer('commands'),
        },
        (item) => model.view?.options.onCommand?.(item)
      ),
      buildSubmitKeymap({
        getShortcut: () => model.view?.options.submitShortcut ?? 'enter',
        onSubmit: () => {
          const current = model.view?.options;
          if (!current?.onSubmit) return;
          const text = serializeDoc(editor.state.doc);
          if (!text.trim() && !current.allowEmptySubmit) return;
          if (current.clearOnSubmit !== false) editor.commands.clearContent(true);
          current.onSubmit(text);
        },
      }),
    ],
    editorProps: {
      attributes: {
        class: cx('prompt-editor-content', styles.promptEditorContentClass),
        'data-testid': 'prompt-editor',
      },
      clipboardTextSerializer: (slice) => {
        const parts: string[] = [];
        slice.content.forEach((node) => parts.push(serializeNode(node)));
        return parts.join('\n').replace(/\n+$/, '');
      },
    },
    onUpdate({ editor: updated }) {
      model.publish();
      model.view?.options.onChange?.(serializeDoc(updated.state.doc));
    },
    element: null,
    content,
  });
  return editor;
}
