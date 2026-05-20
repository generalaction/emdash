import { useHotkey } from '@tanstack/react-hotkeys';
import { ChevronDown, ChevronLeft, ChevronUp, File, MessageSquare, TextInitial, Trash } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  Combobox,
  ComboboxCollection,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@renderer/lib/ui/combobox';
import { Kbd } from '@renderer/lib/ui/kbd';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Shortcut } from '@renderer/lib/ui/shortcut';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { Button } from '@renderer/lib/ui/button';
import { ProviderLogo } from '../components/issue-selector/issue-selector';
import type { DraftComment } from '../diff-view/stores/draft-comments-store';
import {
  buildContextActionText,
  type ContextAction,
  type DraftCommentsContextAction,
} from './context-actions';

// ─── Shared row components ────────────────────────────────────────────────────

export function ActionItemBaseRow({
  icon,
  label,
  text,
}: {
  icon: React.ReactNode;
  label: string;
  text: string;
}) {
  return (
    <div className="min-w-0 w-full flex gap-4 items-center h-5">
      <div className="flex items-center gap-1.5">
        {icon}
        <div className="truncate text-sm font-normal shrink-0 text-foreground-muted">{label}</div>
      </div>
      <div className="text-xs text-foreground-passive truncate">{text}</div>
    </div>
  );
}

export function ActionItemRow({ action }: { action: ContextAction }) {
  switch (action.kind) {
    case 'linked-issue':
      return (
        <ActionItemBaseRow
          icon={
            <ProviderLogo
              provider={action.provider || 'linear'}
              className="h-3.5 w-3.5 shrink-0"
            />
          }
          label={action.issue.title}
          text={action.issue.identifier}
        />
      );
    case 'draft-comments':
      return (
        <ActionItemBaseRow
          icon={<MessageSquare className="size-3.5 shrink-0 text-foreground-muted" />}
          label="Line comments"
          text={`${action.commentCount} comment${action.commentCount !== 1 ? 's' : ''} in ${action.fileCount} file${action.fileCount !== 1 ? 's' : ''}`}
        />
      );
    case 'prompt':
      return (
        <ActionItemBaseRow
          icon={<TextInitial className="size-3.5 shrink-0" />}
          label={action.prompt.title}
          text={action.prompt.prompt}
        />
      );
    default:
      return null;
  }
}

// ─── Comment management view ──────────────────────────────────────────────────

function CommentRow({
  comment,
  isSelected,
  onClick,
}: {
  comment: DraftComment;
  isSelected: boolean;
  onClick: () => void;
}) {
  const fileName = comment.filePath.split('/').at(-1) ?? comment.filePath;
  return (
    <div
      onClick={onClick}
      data-selected={isSelected}
      className="rounded-sm px-2 py-1.5 cursor-default select-none data-[selected=true]:bg-background-quaternary-1"
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <File className="size-3 shrink-0 text-foreground-muted" />
        <span className="text-xs text-foreground-muted truncate shrink">{fileName}</span>
        <div className="flex-1 border-b border-dashed border-border mx-1" />
        <span className="text-xs text-foreground-passive shrink-0">L{comment.lineNumber}</span>
      </div>
      <div className="text-xs text-foreground-passive truncate mt-0.5 pl-[18px]">
        {comment.content}
      </div>
    </div>
  );
}

function CommentsManagerView({
  comments,
  onBack,
  onDeleteComment,
  onDeleteAllComments,
}: {
  comments: DraftComment[];
  onBack: () => void;
  onDeleteComment: (id: string) => void;
  onDeleteAllComments: () => void;
}) {
  // Raw intent — null means "use first item". Derived below.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Derive the effective selection during render: if selectedId is no longer in
  // the list (comment deleted), fall back to the first comment. No useEffect needed.
  const effectiveSelectedId =
    comments.find((c) => c.id === selectedId)?.id ?? comments[0]?.id ?? null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const idx = comments.findIndex((c) => c.id === effectiveSelectedId);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedId(comments[idx + 1]?.id ?? effectiveSelectedId);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedId(comments[idx - 1]?.id ?? effectiveSelectedId);
    } else if (e.key === 'Backspace' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      onDeleteAllComments();
    } else if (e.key === 'Backspace' && effectiveSelectedId) {
      e.preventDefault();
      e.stopPropagation();
      onDeleteComment(effectiveSelectedId);
    }
  };

  return (
    <div
      className="flex flex-col flex-1 outline-none"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="flex items-center gap-1.5 border-b px-2 py-1.5 justify-between">
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon-xs" onClick={onBack}>
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="text-sm text-foreground">Line comments</span>
        </div>
        <Button variant="ghost" size="icon-xs" onClick={onDeleteAllComments}>
          <Trash className="size-3.5" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {comments.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            isSelected={comment.id === effectiveSelectedId}
            onClick={() => setSelectedId(comment.id)}
          />
        ))}
      </div>
      <div className="flex items-center justify-between border-t px-2 py-1.5">
        <span className="flex items-center gap-1">
          <Kbd className="text-foreground-passive">⌫</Kbd>
          <p className="text-xs text-foreground-passive">Delete comment</p>
        </span>
        <span className="flex items-center gap-1">
          <Shortcut hotkey="Mod+Backspace" />
          <p className="text-xs text-foreground-passive">Delete all</p>
        </span>
      </div>
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export interface AddContextPopoverProps {
  actions: ContextAction[];
  disabled: boolean;
  onApplyAction: (
    text: string,
    action: ContextAction,
    opts?: { andSend?: boolean },
  ) => Promise<void>;
  onDeleteComment: (id: string) => void;
  onDeleteAllComments: () => void;
}

export function AddContextPopover({
  actions,
  disabled,
  onApplyAction,
  onDeleteComment,
  onDeleteAllComments,
}: AddContextPopoverProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ContextAction | null>(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'context' | 'comments'>('context');

  const { value: keyboard } = useAppSettingsKey('keyboard');
  const hotkeyRegistration = getHotkeyRegistration('addContext', keyboard);
  const effectiveHotkey = getEffectiveHotkey('addContext', keyboard);

  const draftCommentsAction = actions.find(
    (a): a is DraftCommentsContextAction => a.kind === 'draft-comments',
  );

  // Derive active view during render — no useEffect needed.
  // When all comments are deleted, fall back to context view automatically.
  const currentView = view === 'comments' && !draftCommentsAction ? 'context' : view;

  const filteredActions = useMemo(() => {
    if (!query) return actions;
    const q = query.toLowerCase();
    return actions.filter((action) => {
      switch (action.kind) {
        case 'linked-issue':
          return (
            action.issue.title.toLowerCase().includes(q) ||
            action.issue.identifier.toLowerCase().includes(q)
          );
        case 'draft-comments':
          return 'line comments'.includes(q);
        case 'prompt':
          return (
            action.prompt.title.toLowerCase().includes(q) ||
            action.prompt.prompt.toLowerCase().includes(q)
          );
      }
    });
  }, [query, actions]);

  useHotkey(hotkeyRegistration, () => setOpen((v) => !v), {
    enabled: !disabled && effectiveHotkey !== null,
  });

  const handleConfirm = (action: ContextAction | null, opts?: { andSend?: boolean }) => {
    if (!action) return;
    const text = buildContextActionText(action);
    void onApplyAction(text, action, opts);
    setOpen(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery('');
      setView('context');
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen, eventDetails) => {
        // When Esc is pressed in the comments view, navigate back instead of closing
        if (!nextOpen && currentView === 'comments' && eventDetails.reason === 'escape-key') {
          setView('context');
          return;
        }
        handleOpenChange(nextOpen);
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        className="flex h-6 min-w-[160px] justify-between items-center gap-1.5 rounded-lg text-foreground-muted bg-background-secondary-2 border-border px-2 text-xs font-normal hover:text-foreground hover:bg-background-secondary-3 disabled:pointer-events-none transition-colors"
      >
        <span className="flex items-center gap-1.5">
          {open ? (
            <ChevronUp className="size-3 shrink-0" />
          ) : (
            <ChevronDown className="size-3 shrink-0" />
          )}
          <span>Add context</span>
        </span>
        <Shortcut hotkey={effectiveHotkey} />
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="center"
        className="w-[440px] h-[300px] flex flex-col p-0 gap-0"
        onKeyDown={(e) => {
          if (currentView === 'context' && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            handleConfirm(selected ?? filteredActions[0] ?? null, { andSend: true });
          }
        }}
      >
        {currentView === 'context' ? (
          // Combobox acts as a pure list controller — the Popover owns open/close.
          // open={true} ensures keyboard navigation and autoHighlight always work.
          <div className="flex flex-col flex-1 min-h-0">
            <Combobox
              items={[{ value: 'items', items: filteredActions }]}
              value={null}
              open={true}
              onOpenChange={() => {}}
              onInputValueChange={(value) => setQuery(value ?? '')}
              inputValue={query}
              onValueChange={(action) => handleConfirm(action)}
              onItemHighlighted={(value) => setSelected(value ?? null)}
              autoHighlight={'always' as unknown as boolean}
            >
              <ComboboxInput showTrigger={false} placeholder="Search..." />
              <ComboboxList className="flex-1">
                {(group: { value: string; items: ContextAction[] }) => (
                  <ComboboxGroup items={group.items}>
                    <ComboboxCollection>
                      {(action: ContextAction) => (
                        <ComboboxItem key={action.id} value={action} className="items-start">
                          <ActionItemRow action={action} />
                        </ComboboxItem>
                      )}
                    </ComboboxCollection>
                  </ComboboxGroup>
                )}
              </ComboboxList>
              {filteredActions.length === 0 && (
                <div className="flex flex-1 items-center justify-center py-4 text-sm text-foreground-muted">
                  No context found
                </div>
              )}
            </Combobox>
            <div className="flex items-center justify-between border-t px-2 py-1.5">
              <button
                type="button"
                disabled={!draftCommentsAction}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setView('comments');
                }}
                className="text-xs text-foreground-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                Manage line comments
              </button>
              <span className="flex items-center gap-1">
                <p className="text-xs text-foreground-passive">Add to input</p>
                <Kbd className="text-foreground-passive">↵</Kbd>
              </span>
            </div>
          </div>
        ) : (
          <CommentsManagerView
            comments={draftCommentsAction?.comments ?? []}
            onBack={() => setView('context')}
            onDeleteComment={onDeleteComment}
            onDeleteAllComments={onDeleteAllComments}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
