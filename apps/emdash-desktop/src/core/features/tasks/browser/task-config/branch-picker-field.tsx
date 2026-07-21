import { ChevronDown, GitBranch } from 'lucide-react';
import { ProjectBranchSelector } from '@core/features/source-control/api/browser/components/project-branch-selector';
import type { BranchNameState } from '@core/features/tasks/browser/create-task-modal/use-branch-name';
import type { BranchSelectionState } from '@core/features/tasks/browser/create-task-modal/use-branch-selection';
import { cn } from '@core/primitives/ui/browser/cn';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@core/primitives/ui/browser/collapsible';
import { ComboboxTrigger, ComboboxValue } from '@core/primitives/ui/browser/combobox';
import { BranchDisplay } from '@core/primitives/ui/browser/components/branch-display';
import { Field, FieldLabel } from '@core/primitives/ui/browser/field';
import { Switch } from '@core/primitives/ui/browser/switch';
import { BranchNameField } from './branch-name-field';

interface BranchPickerFieldProps {
  state: BranchSelectionState;
  branchNameState?: BranchNameState;
  projectId?: string;
  currentBranch?: string | null;
  label?: string;
  className?: string;
  isUnborn?: boolean;
}

export function BranchPickerField({
  state,
  branchNameState,
  projectId,
  currentBranch,
  label = 'From Branch',
  className,
  isUnborn = false,
}: BranchPickerFieldProps) {
  const { createBranchAndWorktree, setCreateBranchAndWorktree, pushBranch, setPushBranch } = state;

  return (
    <div className={cn('border border-border rounded-md overflow-hidden', className)}>
      {!createBranchAndWorktree && currentBranch ? (
        <BranchDisplay label={label} branchName={currentBranch} />
      ) : projectId ? (
        <ProjectBranchSelector
          projectId={projectId}
          value={state.selectedBranch}
          onValueChange={state.setSelectedBranch}
          showRemoteSelectorFooter
          trigger={
            <ComboboxTrigger className="flex w-full items-center justify-between gap-2 p-2 outline-none hover:bg-background-1 data-popup-open:bg-background-1">
              <div className="flex flex-col gap-0.5 text-left text-sm">
                <span className="text-xs text-foreground-passive">{label}</span>
                <span className="flex items-center gap-1">
                  <GitBranch
                    absoluteStrokeWidth
                    strokeWidth={2}
                    className="size-3.5 shrink-0 text-foreground-muted"
                  />
                  <ComboboxValue placeholder="Select a branch" />
                </span>
              </div>

              <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
            </ComboboxTrigger>
          }
        />
      ) : null}
      {!isUnborn && (
        <Collapsible className="border-t border-border">
          <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-2 text-xs text-foreground-muted hover:bg-background-1 data-open:bg-background-1">
            Should create and push feature branch
            <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
          </CollapsibleTrigger>
          <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out">
            <div className="flex flex-col gap-2 p-2">
              <Field orientation="horizontal">
                <Switch
                  checked={createBranchAndWorktree}
                  onCheckedChange={setCreateBranchAndWorktree}
                />
                <FieldLabel>Create task branch and worktree</FieldLabel>
              </Field>
              {createBranchAndWorktree && (
                <>
                  {branchNameState && <BranchNameField state={branchNameState} />}
                  <Field orientation="horizontal">
                    <Switch checked={pushBranch} onCheckedChange={setPushBranch} />
                    <FieldLabel>Push branch to remote</FieldLabel>
                  </Field>
                </>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
      {isUnborn && (
        <p className="border-t border-border bg-background-1 px-2 py-1 text-xs text-foreground-muted">
          Create an initial commit to enable branch-based tasks.
        </p>
      )}
    </div>
  );
}
