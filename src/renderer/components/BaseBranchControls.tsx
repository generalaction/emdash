import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { ScrollArea } from './ui/scroll-area';
import { Switch } from './ui/switch';

export type RemoteBranchOption = {
  value: string;
  label: string;
};

const isAgentBranch = (value: string) => value.includes('/agent/');

interface BaseBranchControlsProps {
  baseBranch?: string;
  branchOptions: RemoteBranchOption[];
  isLoadingBranches: boolean;
  isSavingBaseBranch: boolean;
  branchLoadError: string | null;
  onBaseBranchChange: (value: string) => void;
}

const BaseBranchControls: React.FC<BaseBranchControlsProps> = ({
  baseBranch,
  branchOptions,
  isLoadingBranches,
  isSavingBaseBranch,
  branchLoadError,
  onBaseBranchChange,
}) => {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAgentBranches, setShowAgentBranches] = useState(true);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const longestLabelLength = useMemo(
    () => branchOptions.reduce((max, option) => Math.max(max, option.label.length), 0),
    [branchOptions]
  );
  const estimatedDropdownWidthCh = Math.min(60, Math.max(longestLabelLength, 16));
  const dropdownWidth = `min(${estimatedDropdownWidthCh}ch, 32rem)`;
  const navigationKeys = useMemo(
    () => new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Enter', 'Escape']),
    []
  );
  const placeholder = isLoadingBranches
    ? 'Loading branches…'
    : branchOptions.length === 0
      ? 'No remote branches found'
      : 'Select a base branch';
  const filteredOptions = useMemo(() => {
    const baseOptions = showAgentBranches
      ? branchOptions
      : branchOptions.filter((option) => !isAgentBranch(option.value));
    if (!searchTerm.trim()) return baseOptions;
    const query = searchTerm.trim().toLowerCase();
    return baseOptions.filter((option) => option.label.toLowerCase().includes(query));
  }, [branchOptions, searchTerm, showAgentBranches]);

  const displayedOptions = useMemo(() => {
    if (!baseBranch) return filteredOptions;
    const hasSelection = filteredOptions.some((option) => option.value === baseBranch);
    if (hasSelection) return filteredOptions;
    const selectedOption = branchOptions.find((option) => option.value === baseBranch);
    if (!selectedOption) return filteredOptions;
    return [selectedOption, ...filteredOptions];
  }, [filteredOptions, branchOptions, baseBranch]);

  const estimatedRows = Math.max(displayedOptions.length, 1);
  const ROW_HEIGHT = 32;
  const MAX_LIST_HEIGHT = 256;
  const estimatedListHeight = Math.min(MAX_LIST_HEIGHT, estimatedRows * ROW_HEIGHT);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else {
      setSearchTerm('');
    }
  }, [open]);
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <p className="text-xs font-medium text-foreground">Base branch</p>
        <Select
          value={baseBranch}
          onValueChange={onBaseBranchChange}
          disabled={isLoadingBranches || isSavingBaseBranch || branchOptions.length === 0}
          open={open}
          onOpenChange={setOpen}
        >
          <SelectTrigger className="h-8 w-full gap-2 px-3 text-xs font-medium shadow-none sm:w-auto">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent
            className="[&>[data-radix-select-scroll-down-button]]:hidden [&>[data-radix-select-scroll-up-button]]:hidden"
            style={{
              minWidth: 'var(--radix-select-trigger-width)',
              width: dropdownWidth,
            }}
          >
            <div className="px-2 pb-2 pt-2" onPointerDown={(event) => event.stopPropagation()}>
              <input
                ref={searchInputRef}
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (!navigationKeys.has(event.key)) {
                    event.stopPropagation();
                  }
                }}
                placeholder="Search branches"
                className="w-full rounded-md border border-input bg-popover px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex items-center justify-between px-2 pb-2 text-xs text-muted-foreground">
              <label className="flex items-center gap-2">
                <Switch
                  checked={showAgentBranches}
                  onCheckedChange={(checked) => setShowAgentBranches(Boolean(checked))}
                  aria-label="Toggle agent branches"
                />
                Show agent branches
              </label>
            </div>
            <ScrollArea
              className="w-full"
              style={{
                height: `${estimatedListHeight}px`,
                maxHeight: `${MAX_LIST_HEIGHT}px`,
              }}
            >
              <div className="space-y-0">
                {displayedOptions.length > 0 ? (
                  displayedOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))
                ) : (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    No matching branches
                  </div>
                )}
              </div>
            </ScrollArea>
          </SelectContent>
        </Select>
      </div>
      {branchLoadError ? <p className="text-xs text-destructive">{branchLoadError}</p> : null}
      <p className="text-xs text-muted-foreground">
        New workspaces start from the latest code on this branch.
      </p>
    </div>
  );
};

export default BaseBranchControls;
