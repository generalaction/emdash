import React from 'react';
import BranchSelect, { type BranchOption } from './BranchSelect';
import { Button } from './ui/button';
import { GitBranch, Settings2 } from 'lucide-react';

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
    <div className="flex items-center gap-3">
      <BranchSelect
        value={baseBranch}
        onValueChange={onBaseBranchChange}
        options={branchOptions}
        disabled={isSavingBaseBranch}
        isLoading={isLoadingBranches}
        placeholder={placeholder}
        variant="default"
        icon={<GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 px-3 text-xs"
        onClick={onOpenConfig}
        disabled={!onOpenConfig}
      >
        <Settings2 className="h-3.5 w-3.5" />
        Configuration
      </Button>
    </div>
  );
};

export default BaseBranchControls;
