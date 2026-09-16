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
import { EditorContent } from '@tiptap/react';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { AtSign, Braces, CircleDot, File } from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type React from 'react';
import {
  ComboboxPopup,
  type ComboboxPopupHandle,
  type ComboboxPopupItem,
} from '../../primitives/combobox/combobox-popup';
import { fileIconClass } from './mention-pill-helpers';
import { PromptEditorModel } from './prompt-editor-model';
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
  popupRef: React.RefObject<ComboboxPopupHandle | null>,
  onOpenChange?: (open: boolean) => void
): () => {
  onStart?: (props: SuggestionProps) => void;
  onUpdate?: (props: SuggestionProps) => void;
  onExit?: () => void;
  onKeyDown?: (props: SuggestionKeyDownProps) => boolean;
} {
  return () => ({
    onStart(props: SuggestionProps) {
      onOpenChange?.(true);
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
      onOpenChange?.(false);
      setSuggestion(emptySuggestion());
    },
    onKeyDown({ event }: SuggestionKeyDownProps) {
      return popupRef.current?.onKeyDown(event) ?? false;
    },
  });
}

type EditorViewProps = PromptEditorProps & {
  viewportClassName?: string;
};

export const PromptEditor = forwardRef<PromptEditorRef, EditorViewProps>(
  function PromptEditor(props, ref) {
    const {
      model: providedModel,
      value,
      mentions,
      placeholder = 'Message…',
      disabled = false,
      commandPopupOpen,
      className,
      popupClassName,
      viewportClassName,
    } = props;
    const [ownedModel] = useState(() => new PromptEditorModel({ text: value, mentions }));
    const model = providedModel ?? ownedModel;
    const { editor, isEmpty, viewId } = useSyncExternalStore(
      model.subscribe,
      model.getSnapshot,
      model.getSnapshot
    );
    const [mentionSuggestion, setMentionSuggestion] =
      useState<SuggestionState<MentionItem>>(emptySuggestion);
    const [commandSuggestion, setCommandSuggestion] =
      useState<SuggestionState<CommandItem>>(emptySuggestion);
    const mentionPopupRef = useRef<ComboboxPopupHandle | null>(null);
    const commandPopupRef = useRef<ComboboxPopupHandle | null>(null);

    const attach = useCallback(
      (viewport: HTMLDivElement) => {
        const view = model.attach(viewport);
        return () => {
          view.detach();
          if (!providedModel) model.dispose();
        };
      },
      [model, providedModel]
    );

    useLayoutEffect(() => {
      model.commitView(props, {
        mentions: makeSuggestionRender<MentionItem>(setMentionSuggestion, mentionPopupRef),
        commands: makeSuggestionRender<CommandItem>(
          setCommandSuggestion,
          commandPopupRef,
          props.onCommandPopupOpenChange
        ),
      });
    }, [model, props, viewId]);
    useImperativeHandle(ref, () => model, [model]);

    if (providedModel && value !== undefined) {
      throw new Error('PromptEditor accepts either a model or a controlled value, not both');
    }

    const mentionPopupItems = mentionSuggestion.items.map(mentionToPopupItem);
    const commandPopupItems = commandSuggestion.items.map(commandToPopupItem);
    return (
      <>
        <div ref={attach} className={viewportClassName}>
          <div className={cx(styles.editorWrapper, className)}>
            <EditorContent
              key={viewId}
              editor={editor}
              className={styles.editorContent}
              aria-disabled={disabled}
            />
            {isEmpty && (
              <span aria-hidden className={styles.editorPlaceholder}>
                {placeholder}
              </span>
            )}
          </div>
        </div>
        {mentionSuggestion.items.length > 0 && (
          <ComboboxPopup
            ref={mentionPopupRef}
            items={mentionPopupItems}
            anchorRect={mentionSuggestion.rect}
            className={popupClassName}
            wide
            onSelect={(popupItem) => {
              const original = mentionSuggestion.items.find((item) => item.id === popupItem.id);
              if (original) mentionSuggestion.onSelect(original);
            }}
          />
        )}
        {commandSuggestion.items.length > 0 && commandPopupOpen !== false && (
          <ComboboxPopup
            ref={commandPopupRef}
            items={commandPopupItems}
            anchorRect={commandSuggestion.rect}
            className={popupClassName}
            stacked
            onSelect={(popupItem) => {
              const original = commandSuggestion.items.find((item) => item.id === popupItem.id);
              if (original) commandSuggestion.onSelect(original);
            }}
          />
        )}
      </>
    );
  }
);
