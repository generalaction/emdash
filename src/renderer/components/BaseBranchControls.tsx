import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { ScrollArea } from './ui/scroll-area';

export type RemoteBranchOption = {
  value: string;
  label: string;
};

interface BaseBranchControlsProps {
  baseBranch?: string;
  branchOptions: RemoteBranchOption[];
  isLoadingBranches: boolean;
  isSavingBaseBranch: boolean;
  branchLoadError: string | null;
  onBaseBranchChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  projectPath?: string;
}

const BaseBranchControls: React.FC<BaseBranchControlsProps> = ({
  baseBranch,
  branchOptions,
  isLoadingBranches,
  isSavingBaseBranch,
  branchLoadError,
  onBaseBranchChange,
  onOpenChange,
  projectPath,
}) => {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
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
    ? 'Search branches'
    : branchOptions.length === 0
      ? 'No remote branches found'
      : 'Select a base branch';
  const filteredOptions = useMemo(() => {
    if (!searchTerm.trim()) return branchOptions;
    const query = searchTerm.trim().toLowerCase();
    return branchOptions.filter((option) => option.label.toLowerCase().includes(query));
  }, [branchOptions, searchTerm]);

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
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange]
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <p className="text-xs font-medium text-foreground">Base branch</p>
        <Select
          value={branchOptions.length === 0 ? undefined : baseBranch}
          onValueChange={onBaseBranchChange}
          disabled={isLoadingBranches || isSavingBaseBranch || branchOptions.length === 0}
          open={open}
          onOpenChange={handleOpenChange}
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
        New tasks start from the latest code.
        {projectPath && (
          <>
            {' · '}
            <button
              type="button"
              className="text-muted-foreground underline hover:text-foreground"
              onClick={() => window.electronAPI.openProjectConfig(projectPath)}
            >
              Edit Emdash config
            </button>
          </>
        )}
      </p>
    </div>
  );
};

export default BaseBranchControls;
