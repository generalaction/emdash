import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

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
        <p className="text-sm font-medium text-foreground">Base branch:</p>
        <Select
          value={baseBranch}
          onValueChange={onBaseBranchChange}
          disabled={isLoadingBranches || isSavingBaseBranch || branchOptions.length === 0}
        >
          <SelectTrigger className="w-full sm:w-auto sm:min-w-[16rem]">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {branchOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
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
