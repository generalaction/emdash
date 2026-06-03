import { useHotkey, type Hotkey } from '@tanstack/react-hotkeys';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Folder,
  MessageSquare,
  TextInitial,
} from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@renderer/lib/ui/combobox';
import { Kbd } from '@renderer/lib/ui/kbd';
import { Shortcut } from '@renderer/lib/ui/shortcut';
import type { PromptLibraryFolder } from '@shared/prompt-library';
import { ProviderLogo } from '../components/issue-selector/issue-selector';
import {
  buildAddContextListEntries,
  getAddContextConfirmableEntry,
  type AddContextListEntry,
} from './add-context-list';
import { buildContextActionText, type ContextAction } from './context-actions';

const ADD_CONTEXT_HOTKEY: Hotkey = 'Mod+Shift+A';
type AddContextPopoverSide = 'top' | 'bottom';

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
    <div className="flex h-5 w-full min-w-0 items-center gap-4">
      <div className="flex items-center gap-1.5">
        {icon}
        <div className="shrink-0 truncate text-sm font-normal text-foreground-muted">{label}</div>
      </div>
      <div className="truncate text-xs text-foreground-passive">{text}</div>
    </div>
  );
}

function formatFolderPromptCount(count: number) {
  if (count === 0) return 'Empty';
  return `${count} ${count === 1 ? 'prompt' : 'prompts'}`;
}

export function AddContextListEntryRow({ entry }: { entry: AddContextListEntry }) {
  switch (entry.kind) {
    case 'folder':
      return (
        <ActionItemBaseRow
          icon={<Folder className="size-3.5 shrink-0 text-foreground-muted" />}
          label={entry.folder.title}
          text={formatFolderPromptCount(entry.promptCount)}
        />
      );
    case 'action':
      return <ActionItemRow action={entry.action} />;
    default:
      return null;
  }
}

export function ActionItemRow({ action }: { action: ContextAction }) {
  switch (action.kind) {
    case 'linked-issue':
      return (
        <ActionItemBaseRow
          icon={
            <ProviderLogo provider={action.provider || 'linear'} className="h-3.5 w-3.5 shrink-0" />
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

export interface AddContextPopoverProps {
  actions: ContextAction[];
  promptFolders?: PromptLibraryFolder[];
  disabled: boolean;
  isActivePane?: boolean;
  onApplyAction: (
    text: string,
    action: ContextAction,
    opts?: { andSend?: boolean }
  ) => Promise<void>;
  /** Replace the default "Add context" button with a custom trigger. */
  renderTrigger?: (ctx: { open: boolean; disabled: boolean }) => ReactNode;
  side?: AddContextPopoverSide;
}

export function AddContextPopover({
  actions,
  promptFolders = [],
  disabled,
  isActivePane = true,
  onApplyAction,
  renderTrigger,
  side = 'top',
}: AddContextPopoverProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<AddContextListEntry | null>(null);
  const [browseFolderId, setBrowseFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const ignoreOpenUntilRef = useRef(0);
  const suppressCloseRef = useRef(false);

  const listEntries = useMemo(
    () =>
      buildAddContextListEntries({
        actions,
        folders: promptFolders,
        browseFolderId,
        query,
      }),
    [actions, browseFolderId, promptFolders, query]
  );

  useHotkey(ADD_CONTEXT_HOTKEY, () => setOpen((v) => !v), { enabled: !disabled && isActivePane });

  const handleConfirm = (action: ContextAction | null, opts?: { andSend?: boolean }) => {
    if (!action) return;
    const text = buildContextActionText(action);
    void onApplyAction(text, action, opts);
    setOpen(false);
  };

  const handleListEntrySelect = (entry: AddContextListEntry | null) => {
    if (!entry) return;
    if (entry.kind === 'folder') {
      suppressCloseRef.current = true;
      setBrowseFolderId(entry.folder.id);
      setQuery('');
      return;
    }
    handleConfirm(entry.action);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && Date.now() < ignoreOpenUntilRef.current) {
      return;
    }
    if (!nextOpen && suppressCloseRef.current) {
      suppressCloseRef.current = false;
      return;
    }
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery('');
      setBrowseFolderId(null);
    }
  };

  const blockComboboxOpenForContextMenu = () => {
    ignoreOpenUntilRef.current = Date.now() + 500;
  };

  const blockSyntheticClickAfterContextMenu = (event: React.SyntheticEvent) => {
    if (Date.now() >= ignoreOpenUntilRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const browseFolder = browseFolderId
    ? promptFolders.find((folder) => folder.id === browseFolderId)
    : null;

  const navigateBackFromFolder = () => {
    setBrowseFolderId(null);
  };

  const handleBrowseBackKey = (event: React.KeyboardEvent) => {
    if (!browseFolderId || query.trim()) return;
    if (event.key === 'Escape' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      navigateBackFromFolder();
    }
  };

  return (
    <Combobox
      items={[{ value: 'items', items: listEntries }]}
      value={null}
      onInputValueChange={(value) => setQuery(value ?? '')}
      inputValue={query}
      onValueChange={(entry) => handleListEntrySelect(entry)}
      onItemHighlighted={(value) => setSelected(value ?? null)}
      open={open}
      onOpenChange={handleOpenChange}
      autoHighlight={'always' as unknown as boolean}
    >
      <ComboboxTrigger
        disabled={disabled}
        onContextMenuCapture={() => blockComboboxOpenForContextMenu()}
        onPointerDownCapture={(event) => {
          if (event.button !== 0) blockComboboxOpenForContextMenu();
        }}
        onMouseDownCapture={(event) => {
          if (event.button !== 0) blockComboboxOpenForContextMenu();
        }}
        onClickCapture={(event) => {
          if (event.button !== 0) blockComboboxOpenForContextMenu();
          blockSyntheticClickAfterContextMenu(event);
        }}
        className={
          renderTrigger
            ? undefined
            : 'flex h-6 min-w-[160px] items-center justify-between gap-1.5 rounded-lg border-border bg-background-secondary-2 px-2 text-xs font-normal text-foreground-muted transition-colors hover:bg-background-secondary-3 hover:text-foreground disabled:pointer-events-none'
        }
      >
        {renderTrigger ? (
          renderTrigger({ open, disabled })
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              {open ? (
                <ChevronUp className="size-3 shrink-0" />
              ) : (
                <ChevronDown className="size-3 shrink-0" />
              )}
              <span>Add context</span>
            </span>
            <Shortcut hotkey={ADD_CONTEXT_HOTKEY} />
          </>
        )}
      </ComboboxTrigger>

      <ComboboxContent
        side={side}
        align="center"
        className="flex min-h-[200px] max-w-[92vw] min-w-[440px] flex-col"
        onKeyDown={(e) => {
          handleBrowseBackKey(e);
          if (e.defaultPrevented) return;
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
            const entry = selected ?? listEntries[0] ?? null;
            if (entry?.kind === 'folder') {
              e.preventDefault();
              e.stopPropagation();
              handleListEntrySelect(entry);
              return;
            }
          }
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            handleConfirm(getAddContextConfirmableEntry(listEntries, selected), { andSend: true });
          }
        }}
      >
        {browseFolder && !query.trim() ? (
          <div className="flex items-center gap-1 border-b px-2 py-1.5 text-xs text-foreground-muted">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 hover:bg-background-2 hover:text-foreground"
              onClick={() => setBrowseFolderId(null)}
            >
              <ArrowLeft className="size-3.5" />
              Back
            </button>
            <span className="text-foreground-passive">/</span>
            <span className="truncate font-medium text-foreground">{browseFolder.title}</span>
          </div>
        ) : null}
        <ComboboxInput
          showTrigger={false}
          placeholder={
            browseFolderId && !query.trim()
              ? `Search in ${browseFolder?.title ?? 'folder'}...`
              : 'Search...'
          }
        />
        <ComboboxList className="flex-1">
          {(group: { value: string; items: AddContextListEntry[] }) => (
            <ComboboxGroup items={group.items}>
              <ComboboxCollection>
                {(entry: AddContextListEntry) => (
                  <ComboboxItem
                    key={entry.id}
                    value={entry}
                    className="items-start data-highlighted:bg-background-2!"
                  >
                    <div className="flex w-full min-w-0 items-center gap-2">
                      <AddContextListEntryRow entry={entry} />
                      {entry.kind === 'folder' ? (
                        <ChevronRight className="size-3.5 shrink-0 text-foreground-passive" />
                      ) : null}
                    </div>
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
        <ComboboxEmpty className="flex flex-1 items-center justify-center">
          {browseFolderId && !query.trim() ? 'No prompts in this folder' : 'No context found'}
        </ComboboxEmpty>
        <div className="flex items-center justify-end border-t px-2 py-1.5">
          <span className="flex items-center gap-1">
            <p className="text-xs text-foreground-passive">
              {selected?.kind === 'folder' && !query.trim() ? 'Open folder' : 'Add to input'}
            </p>
            <Kbd className="text-foreground-passive">↵</Kbd>
          </span>
        </div>
      </ComboboxContent>
    </Combobox>
  );
}
