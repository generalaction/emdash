import React from 'react';
import BranchSelect, { type BranchOption } from './BranchSelect';
import { Button } from './ui/button';

interface BaseBranchControlsProps {
  baseBranch?: string;
  branchOptions: BranchOption[];
  isLoadingBranches: boolean;
  isSavingBaseBranch: boolean;
  onBaseBranchChange: (value: string) => void;
  onOpenConfig?: () => void;
}

const BaseBranchControls: React.FC<BaseBranchControlsProps> = ({
  baseBranch,
  branchOptions,
  isLoadingBranches,
  isSavingBaseBranch,
  onBaseBranchChange,
  onOpenConfig,
}) => {
  const placeholder = isLoadingBranches
    ? 'Loading...'
    : branchOptions.length === 0
      ? 'No branches found'
      : 'Select a base branch';

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <p className="text-sm font-medium text-foreground">Config</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 px-3 text-xs sm:w-auto"
          onClick={onOpenConfig}
          disabled={!onOpenConfig}
        >
          Open
        </Button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <p className="text-sm font-medium text-foreground">Base branch</p>
        <BranchSelect
          value={baseBranch}
          onValueChange={onBaseBranchChange}
          options={branchOptions}
          disabled={isSavingBaseBranch}
          isLoading={isLoadingBranches}
          placeholder={placeholder}
          variant="default"
        />
      </div>
    </div>
  );
};

export default BaseBranchControls;
