import React from 'react';
import BranchSelect, { type BranchOption } from './BranchSelect';

export type RemoteBranchOption = BranchOption;

interface BaseBranchControlsProps {
  baseBranch?: string;
  branchOptions: RemoteBranchOption[];
  isLoadingBranches: boolean;
  isSavingBaseBranch: boolean;
  onBaseBranchChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  projectPath?: string;
  onEditConfig?: () => void;
}

const BaseBranchControls: React.FC<BaseBranchControlsProps> = ({
  baseBranch,
  branchOptions,
  isLoadingBranches,
  isSavingBaseBranch,
  onBaseBranchChange,
  onOpenChange,
  projectPath,
  onEditConfig,
}) => {
  const placeholder = isLoadingBranches
    ? 'Loading...'
    : branchOptions.length === 0
      ? 'No remote branches found'
      : 'Select a base branch';

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <p className="text-xs font-medium text-foreground">Base branch</p>
        <BranchSelect
          value={baseBranch}
          onValueChange={onBaseBranchChange}
          options={branchOptions}
          disabled={isSavingBaseBranch}
          isLoading={isLoadingBranches}
          placeholder={placeholder}
          variant="default"
          onOpenChange={onOpenChange}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        New tasks start from the latest code.
        {projectPath && onEditConfig && (
          <>
            {' · '}
            <button
              type="button"
              className="text-muted-foreground underline hover:text-foreground"
              onClick={onEditConfig}
            >
              Edit config
            </button>
          </>
        )}
      </p>
    </div>
  );
};

export default BaseBranchControls;
