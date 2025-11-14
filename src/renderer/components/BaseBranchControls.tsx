import React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from './ui/button';
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
  isFetchingBaseBranch: boolean;
  onBaseBranchChange: (value: string) => void;
  onFetchLatest: () => void;
}

const BaseBranchControls: React.FC<BaseBranchControlsProps> = ({
  baseBranch,
  branchOptions,
  isLoadingBranches,
  isSavingBaseBranch,
  branchLoadError,
  isFetchingBaseBranch,
  onBaseBranchChange,
  onFetchLatest,
}) => {
  const placeholder = isLoadingBranches
    ? 'Loading branches…'
    : branchOptions.length === 0
      ? 'No remote branches found'
      : 'Select a base branch';

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
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
        <Button
          variant="ghost"
          size="sm"
          onClick={onFetchLatest}
          disabled={isFetchingBaseBranch}
          aria-busy={isFetchingBaseBranch}
          className="h-8 px-3 text-xs font-medium sm:self-start"
        >
          {isFetchingBaseBranch ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Fetching…
            </>
          ) : (
            'Fetch latest'
          )}
        </Button>
      </div>
      {branchLoadError ? <p className="text-xs text-destructive">{branchLoadError}</p> : null}
      <p className="text-xs text-muted-foreground">
        New workspaces start from the latest code on this branch.
      </p>
    </div>
  );
};

export default BaseBranchControls;
