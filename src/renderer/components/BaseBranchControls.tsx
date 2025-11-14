import React from 'react';
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
}

const BaseBranchControls: React.FC<BaseBranchControlsProps> = ({
  baseBranch,
  branchOptions,
  isLoadingBranches,
  isSavingBaseBranch,
  branchLoadError,
  onBaseBranchChange,
}) => {
  const placeholder = isLoadingBranches
    ? 'Loading branches…'
    : branchOptions.length === 0
      ? 'No remote branches found'
      : 'Select a base branch';
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <p className="text-xs font-medium text-foreground">Base branch</p>
        <Select
          value={baseBranch}
          onValueChange={onBaseBranchChange}
          disabled={isLoadingBranches || isSavingBaseBranch || branchOptions.length === 0}
        >
          <SelectTrigger className="h-8 w-full gap-2 px-3 text-xs font-medium shadow-none sm:w-auto">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent className="[&>[data-radix-select-scroll-up-button]]:hidden [&>[data-radix-select-scroll-down-button]]:hidden">
            <ScrollArea
              className="w-full"
              style={{
                maxHeight: '16rem',
                height: 'min(16rem, var(--radix-select-content-available-height))',
              }}
            >
              <div className="space-y-0">
                {branchOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
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
