import { useHotkey, type Hotkey } from '@tanstack/react-hotkeys';
import { ChevronDown, ChevronUp, MessageSquare, TextInitial } from 'lucide-react';
import { useMemo, useState } from 'react';
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
import { ProviderLogo } from '../components/issue-selector/issue-selector';
import { buildContextActionText, type ContextAction } from './context-actions';

const ADD_CONTEXT_HOTKEY: Hotkey = 'Mod+Shift+A';

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

export function ActionItemRow({ action }: { action: ContextAction }) {
  switch (action.kind) {
    case 'linked-issue':
      return (
        <ActionItemBaseRow
          icon={
            <ProviderLogo provider={action.provider || 'linear'} className="size-3.5 shrink-0" />
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
  disabled: boolean;
  isActivePane?: boolean;
  onApplyAction: (
    text: string,
    action: ContextAction,
    opts?: { andSend?: boolean }
  ) => Promise<void>;
}

export function AddContextPopover({
  actions,
  disabled,
  isActivePane = true,
  onApplyAction,
}: AddContextPopoverProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ContextAction | null>(null);
  const [query, setQuery] = useState('');

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

  useHotkey(ADD_CONTEXT_HOTKEY, () => setOpen((v) => !v), { enabled: !disabled && isActivePane });

  const handleConfirm = (action: ContextAction | null, opts?: { andSend?: boolean }) => {
    if (!action) return;
    const text = buildContextActionText(action);
    void onApplyAction(text, action, opts);
    setOpen(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setQuery('');
  };

  return (
    <Combobox
      items={[{ value: 'items', items: filteredActions }]}
      value={null}
      onInputValueChange={(value) => setQuery(value ?? '')}
      inputValue={query}
      onValueChange={(action) => handleConfirm(action)}
      onItemHighlighted={(value) => setSelected(value ?? null)}
      open={open}
      onOpenChange={handleOpenChange}
      // 'always' highlights the first item on open; Base UI types narrow to boolean
      // but the runtime accepts the string literal
      autoHighlight={'always' as unknown as boolean}
    >
      <ComboboxTrigger
        disabled={disabled}
        className="flex h-6 min-w-[160px] items-center justify-between gap-1.5 rounded-lg border-border bg-background-secondary-2 px-2 text-xs font-normal text-foreground-muted transition-colors hover:bg-background-secondary-3 hover:text-foreground disabled:pointer-events-none"
      >
        <span className="flex items-center gap-1.5">
          {open ? (
            <ChevronUp className="size-3 shrink-0" />
          ) : (
            <ChevronDown className="size-3 shrink-0" />
          )}
          <span>Add context</span>
        </span>
        <Shortcut hotkey={ADD_CONTEXT_HOTKEY} />
      </ComboboxTrigger>

      <ComboboxContent
        side="top"
        align="center"
        className="flex min-h-[200px] max-w-[92vw] min-w-[440px] flex-col"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            handleConfirm(selected ?? filteredActions[0] ?? null, { andSend: true });
          }
        }}
      >
        <ComboboxInput showTrigger={false} placeholder="Search..." />
        <ComboboxList className="flex-1">
          {(group: { value: string; items: ContextAction[] }) => (
            <ComboboxGroup items={group.items}>
              <ComboboxCollection>
                {(action: ContextAction) => (
                  <ComboboxItem
                    key={action.id}
                    value={action}
                    className="items-start data-highlighted:bg-background-2!"
                  >
                    <ActionItemRow action={action} />
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
        <ComboboxEmpty className="flex flex-1 items-center justify-center">
          No context found
        </ComboboxEmpty>
        <div className="flex items-center justify-end border-t px-2 py-1.5">
          <span className="flex items-center gap-1">
            <p className="text-xs text-foreground-passive">Add to input</p>
            <Kbd className="text-foreground-passive">↵</Kbd>
          </span>
        </div>
      </ComboboxContent>
    </Combobox>
  );
}
