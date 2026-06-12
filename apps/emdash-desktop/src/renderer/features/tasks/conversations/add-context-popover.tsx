import { useHotkey, type Hotkey } from '@tanstack/react-hotkeys';
import {
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
import { buildContextActionText, type ContextAction } from './context-actions';

const ADD_CONTEXT_HOTKEY: Hotkey = 'Mod+Shift+A';
type AddContextPopoverSide = 'top' | 'bottom';

// Folders from the prompt library appear as navigable entries: Enter (or
// click) descends into the folder, Backspace on an empty query goes back.
type FolderMenuItem = {
  id: string;
  kind: 'folder';
  folder: PromptLibraryFolder;
  count: number;
};

type MenuItem = ContextAction | FolderMenuItem;

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

export function ActionItemRow({ action }: { action: MenuItem }) {
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
    case 'folder':
      return (
        <div className="flex h-5 w-full min-w-0 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex items-center gap-1.5">
              <Folder className="size-3.5 shrink-0 text-foreground-muted" />
              <div className="shrink-0 truncate text-sm font-normal text-foreground-muted">
                {action.folder.name}
              </div>
            </div>
            <div className="truncate text-xs text-foreground-passive">
              {action.count} prompt{action.count !== 1 ? 's' : ''}
            </div>
          </div>
          <ChevronRight className="size-3.5 shrink-0 text-foreground-passive" />
        </div>
      );
    default:
      return null;
  }
}

function matchesQuery(action: ContextAction, q: string): boolean {
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
}

export interface AddContextPopoverProps {
  actions: ContextAction[];
  folders?: PromptLibraryFolder[];
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
  folders = [],
  disabled,
  isActivePane = true,
  onApplyAction,
  renderTrigger,
  side = 'top',
}: AddContextPopoverProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [query, setQuery] = useState('');
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const ignoreOpenUntilRef = useRef(0);
  // Selecting a folder navigates instead of confirming; Base UI still requests
  // a close (and may echo the item into the input), so both are suppressed for
  // a moment around folder selection.
  const keepOpenUntilRef = useRef(0);

  const activeFolder = useMemo(
    () => folders.find((folder) => folder.id === activeFolderId) ?? null,
    [folders, activeFolderId]
  );

  const items = useMemo<MenuItem[]>(() => {
    const q = query.trim().toLowerCase();

    if (activeFolder) {
      const folderPrompts = actions.filter(
        (action) => action.kind === 'prompt' && action.prompt.folderId === activeFolder.id
      );
      return q ? folderPrompts.filter((action) => matchesQuery(action, q)) : folderPrompts;
    }

    // Searching flattens folders so every prompt stays findable from the root.
    if (q) return actions.filter((action) => matchesQuery(action, q));

    const folderIds = new Set(folders.map((folder) => folder.id));
    const folderItems: FolderMenuItem[] = folders
      .map((folder) => ({
        id: `folder:${folder.id}`,
        kind: 'folder' as const,
        folder,
        count: actions.filter(
          (action) => action.kind === 'prompt' && action.prompt.folderId === folder.id
        ).length,
      }))
      .filter((item) => item.count > 0);
    const rootActions = actions.filter(
      (action) =>
        action.kind !== 'prompt' ||
        !action.prompt.folderId ||
        !folderIds.has(action.prompt.folderId)
    );
    const nonPromptActions = rootActions.filter((action) => action.kind !== 'prompt');
    const rootPrompts = rootActions.filter((action) => action.kind === 'prompt');
    return [...nonPromptActions, ...folderItems, ...rootPrompts];
  }, [query, actions, folders, activeFolder]);

  useHotkey(ADD_CONTEXT_HOTKEY, () => setOpen((v) => !v), { enabled: !disabled && isActivePane });

  const enterFolder = (folderId: string) => {
    keepOpenUntilRef.current = Date.now() + 200;
    setActiveFolderId(folderId);
    setQuery('');
    setOpen(true);
  };

  const leaveFolder = () => {
    setActiveFolderId(null);
    setQuery('');
  };

  const handleConfirm = (item: MenuItem | null, opts?: { andSend?: boolean }) => {
    if (!item) return;
    if (item.kind === 'folder') {
      enterFolder(item.folder.id);
      return;
    }
    const text = buildContextActionText(item);
    void onApplyAction(text, item, opts);
    setOpen(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && Date.now() < ignoreOpenUntilRef.current) {
      return;
    }
    if (!nextOpen && Date.now() < keepOpenUntilRef.current) {
      return;
    }
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery('');
      setActiveFolderId(null);
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

  return (
    <Combobox
      items={[{ value: 'items', items }]}
      value={null}
      onInputValueChange={(value) => {
        // Ignore the input echo of a just-selected folder item.
        if (Date.now() < keepOpenUntilRef.current) return;
        setQuery(value ?? '');
      }}
      inputValue={query}
      onValueChange={(item) => handleConfirm(item)}
      onItemHighlighted={(value) => setSelected(value ?? null)}
      open={open}
      onOpenChange={handleOpenChange}
      // 'always' highlights the first item on open; Base UI types narrow to boolean
      // but the runtime accepts the string literal
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
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            handleConfirm(selected ?? items[0] ?? null, { andSend: true });
            return;
          }
          if (e.key === 'Backspace' && activeFolder && query.length === 0) {
            e.preventDefault();
            leaveFolder();
          }
        }}
      >
        <ComboboxInput
          showTrigger={false}
          placeholder={activeFolder ? `Search in ${activeFolder.name}...` : 'Search...'}
          leftAddon={
            activeFolder ? (
              <span className="flex max-w-40 items-center gap-1 rounded bg-background-2 px-1.5 py-0.5 text-xs text-foreground-muted">
                <Folder className="size-3 shrink-0" />
                <span className="truncate">{activeFolder.name}</span>
              </span>
            ) : undefined
          }
        />
        <ComboboxList className="flex-1">
          {(group: { value: string; items: MenuItem[] }) => (
            <ComboboxGroup items={group.items}>
              <ComboboxCollection>
                {(item: MenuItem) => (
                  <ComboboxItem
                    key={item.id}
                    value={item}
                    className="items-start data-highlighted:bg-background-2!"
                  >
                    <ActionItemRow action={item} />
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
        <ComboboxEmpty className="flex flex-1 items-center justify-center">
          {activeFolder ? 'No prompts found' : 'No context found'}
        </ComboboxEmpty>
        <div className="flex items-center justify-between border-t px-2 py-1.5">
          <span className="flex items-center gap-1">
            {activeFolder && (
              <>
                <Kbd className="text-foreground-passive">⌫</Kbd>
                <p className="text-xs text-foreground-passive">Back</p>
              </>
            )}
          </span>
          <span className="flex items-center gap-1">
            <p className="text-xs text-foreground-passive">
              {selected?.kind === 'folder' ? 'Open folder' : 'Add to input'}
            </p>
            <Kbd className="text-foreground-passive">↵</Kbd>
          </span>
        </div>
      </ComboboxContent>
    </Combobox>
  );
}
