import { GitBranch, RefreshCw } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Badge } from '@renderer/lib/ui/badge';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@renderer/lib/ui/combobox';
import { InputGroupButton } from '@renderer/lib/ui/input-group';
import { Select, SelectTrigger } from '@renderer/lib/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { cn } from '@renderer/utils/utils';
import { type Branch, type Remote } from '@shared/git';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import {
  filterBranchesForPicker,
  getBranchLabel,
  prioritizeExactBranchMatches,
  type BranchLabelRemoteMode,
} from './branch-selector-utils';
import { RemoteSelectContent } from './remote-select-content';

type BranchSelectorTab = 'local' | 'remote';
export { getBranchLabel, type BranchLabelRemoteMode } from './branch-selector-utils';

interface BranchSelectorProps {
  branches: Branch[];
  value?: Branch;
  onValueChange: (value: Branch) => void;
  remoteOnly?: boolean;
  branchLabelRemote?: BranchLabelRemoteMode;
  trigger?: React.ReactNode;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  remotes?: Remote[];
  selectedRemoteName?: string;
}

export function BranchSelector({
  branches,
  value,
  onValueChange,
  remoteOnly = false,
  branchLabelRemote = 'full',
  trigger,
  onRefresh,
  isRefreshing = false,
  remotes,
  selectedRemoteName,
}: BranchSelectorProps) {
  const valueKey =
    value?.type === 'remote'
      ? `${value.type}:${value.remote.name}/${value.branch}`
      : `${value?.type ?? 'none'}:${value?.branch ?? ''}`;
  const [tabOverride, setTabOverride] = useState<
    { tab: BranchSelectorTab; valueKey: string } | undefined
  >(undefined);
  const overriddenTab = tabOverride?.valueKey === valueKey ? tabOverride.tab : undefined;
  const tab = remoteOnly ? 'remote' : (overriddenTab ?? value?.type ?? 'local');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const keepOpenForRemoteSelectRef = React.useRef(false);
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [remoteSelectOpen, setRemoteSelectOpen] = useState(false);
  const [draftRemoteName, setDraftRemoteName] = useState<string | undefined>(undefined);
  const showRemoteFooter = selectedRemoteName !== undefined;
  const activeRemoteName =
    showRemoteFooter && open ? (draftRemoteName ?? selectedRemoteName) : selectedRemoteName;

  const localCount = useMemo(() => branches.filter((b) => b.type === 'local').length, [branches]);
  const remoteCount = useMemo(
    () =>
      branches.filter(
        (b) => b.type === 'remote' && (!showRemoteFooter || b.remote.name === activeRemoteName)
      ).length,
    [activeRemoteName, branches, showRemoteFooter]
  );

  const filteredBranches = useMemo(
    () =>
      prioritizeExactBranchMatches(
        filterBranchesForPicker(branches, tab, showRemoteFooter ? activeRemoteName : undefined),
        inputValue,
        branchLabelRemote
      ),
    [activeRemoteName, branchLabelRemote, branches, inputValue, showRemoteFooter, tab]
  );

  const options = useMemo(
    () =>
      filteredBranches.map((branch) => ({
        value: branch,
        label: getBranchLabel(branch, { remote: branchLabelRemote }),
        disabled: branch.branch.startsWith('_reserve'),
      })),
    [branchLabelRemote, filteredBranches]
  );

  return (
    <Combobox
      open={open}
      inputValue={inputValue}
      onInputValueChange={(nextInputValue: string, { reason }: { reason: string }) => {
        if (reason !== 'item-press') setInputValue(nextInputValue);
      }}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && keepOpenForRemoteSelectRef.current) {
          setOpen(true);
          return;
        }
        setOpen(nextOpen);
        if (!nextOpen) setInputValue('');
        setDraftRemoteName(nextOpen ? selectedRemoteName : undefined);
      }}
      items={options}
      autoHighlight
      value={
        value
          ? {
              value,
              label: getBranchLabel(value, { remote: branchLabelRemote }),
            }
          : undefined
      }
      onValueChange={(v) => v !== null && onValueChange(v.value)}
      isItemEqualToValue={(a, b) => {
        if (a.value.type !== b.value.type) return false;
        if (a.value.branch !== b.value.branch) return false;
        if (a.value.type === 'remote' && b.value.type === 'remote') {
          return a.value.remote.name === b.value.remote.name;
        }
        return true;
      }}
    >
      {trigger ?? (
        <ComboboxTrigger className="hover:bg-muted/30 flex h-9 items-center justify-between rounded-md border border-border px-2.5 py-1 text-left text-sm outline-none">
          <div className="text-muted-foreground flex items-center gap-2">
            <GitBranch />
            <ComboboxValue placeholder="Select a branch" />
          </div>
        </ComboboxTrigger>
      )}
      <ComboboxContent
        className={cn('min-w-(--anchor-width) border', showRemoteFooter ? 'pb-0' : 'pb-1')}
      >
        {!remoteOnly && (
          <ToggleGroup
            value={[tab]}
            onValueChange={([value]) => {
              if (value) {
                setTabOverride({ tab: value as BranchSelectorTab, valueKey });
                inputRef.current?.focus();
              }
            }}
            className="w-full rounded-b-none border-0 border-b border-border bg-transparent"
          >
            <ToggleGroupItem
              value="local"
              className="group flex flex-1 items-center gap-1 hover:bg-background-quaternary-1 data-pressed:bg-background-quaternary-2"
              disabled={localCount === 0}
            >
              Local
              <Badge
                variant="secondary"
                className="group-data-pressed:bg-background-quaternary-3 shrink-0 bg-background-2 transition-colors hover:bg-background-quaternary-1"
              >
                {localCount}
              </Badge>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="remote"
              className="group flex flex-1 items-center gap-1 hover:bg-background-quaternary-1 data-pressed:bg-background-quaternary-2"
              disabled={remoteCount === 0}
            >
              Remote
              <Badge variant="secondary" className="shrink-0 bg-background-2 transition-colors">
                {remoteCount}
              </Badge>
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        <ComboboxInput
          showTrigger={false}
          placeholder="Search branches"
          inputRef={inputRef}
          rightAddon={
            onRefresh && (
              <Tooltip>
                <TooltipTrigger>
                  <InputGroupButton
                    size="icon-xs"
                    className="text-foreground-muted hover:text-foreground"
                    onClick={onRefresh}
                    disabled={isRefreshing}
                    aria-label="Refresh branches"
                  >
                    <RefreshCw className={cn('size-3', isRefreshing && 'animate-spin')} />
                  </InputGroupButton>
                </TooltipTrigger>
                <TooltipContent>Refresh branches</TooltipContent>
              </Tooltip>
            )
          }
        />
        <ComboboxList>
          {(item) => (
            <ComboboxItem value={item} disabled={item.disabled}>
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
        <ComboboxEmpty>{branches.length === 0 ? 'no branches exist' : 'no results'}</ComboboxEmpty>
        {showRemoteFooter && (
          <div className="border-t border-border">
            <Select
              open={remoteSelectOpen}
              onOpenChange={(nextOpen) => {
                setRemoteSelectOpen(nextOpen);
                keepOpenForRemoteSelectRef.current = true;
                if (nextOpen) {
                  setOpen(true);
                } else {
                  requestAnimationFrame(() => {
                    keepOpenForRemoteSelectRef.current = false;
                  });
                }
              }}
              value={activeRemoteName}
              onValueChange={(remoteName) => {
                if (!remoteName) return;
                keepOpenForRemoteSelectRef.current = true;
                setDraftRemoteName(remoteName);
                setTabOverride({ tab: 'remote', valueKey });
                setOpen(true);
                requestAnimationFrame(() => {
                  setOpen(true);
                  inputRef.current?.focus();
                  keepOpenForRemoteSelectRef.current = false;
                });
              }}
            >
              <SelectTrigger className="h-7 w-full rounded-none border-0 bg-transparent px-3 text-sm shadow-none hover:bg-background-quaternary-1 focus-visible:ring-0">
                <span className="min-w-0 flex-1 truncate text-left text-foreground-muted">
                  {activeRemoteName}
                </span>
              </SelectTrigger>
              <RemoteSelectContent
                remotes={remotes ?? []}
                fallbackRemoteName={activeRemoteName ?? selectedRemoteName}
              />
            </Select>
          </div>
        )}
      </ComboboxContent>
    </Combobox>
  );
}
