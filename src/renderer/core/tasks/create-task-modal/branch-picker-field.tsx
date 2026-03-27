import { ChevronDown, GitBranch } from 'lucide-react';
import { Branch } from '@shared/git';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@renderer/components/ui/collapsible';
import { ComboboxTrigger, ComboboxValue } from '@renderer/components/ui/combobox';
import { Field, FieldLabel } from '@renderer/components/ui/field';
import { MicroLabel } from '@renderer/components/ui/label';
import { Switch } from '@renderer/components/ui/switch';
import { BranchSelector } from '@renderer/views/projects/branch-selector';
import { BranchSelectionState } from './use-branch-selection';

interface BranchPickerFieldProps {
  state: BranchSelectionState;
  branches: Branch[];
  label?: string;
}

export function BranchPickerField({
  state,
  branches,
  label = 'From Branch',
}: BranchPickerFieldProps) {
  const { createBranchAndWorktree, setCreateBranchAndWorktree, pushBranch, setPushBranch } = state;

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <BranchSelector
        branches={branches}
        value={state.selectedBranch}
        onValueChange={state.setSelectedBranch}
        trigger={
          <ComboboxTrigger className="flex w-full items-center gap-2 justify-between hover:bg-background-1 data-popup-open:bg-background-1 p-2 outline-none">
            <div className="flex items-center gap-2">
              <GitBranch
                absoluteStrokeWidth
                strokeWidth={1}
                className="size-8 shrink-0 text-foreground-passive"
              />
              <div className="flex flex-col text-left text-sm">
                <MicroLabel className="text-foreground-passive text-xs">{label}</MicroLabel>
                <ComboboxValue placeholder="Select a branch" />
              </div>
            </div>
            <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
          </ComboboxTrigger>
        }
      />
      <Collapsible className="border-t border-border">
        <CollapsibleTrigger className="w-full p-2 hover:bg-background-1 data-open:bg-background-1 flex text-xs text-foreground-muted items-center gap-2 justify-between">
          Should create and push feature branch
          <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden h-(--collapsible-panel-height) transition-[height] duration-200 ease-out">
          <div className="p-2 flex flex-col gap-2">
            <Field orientation="horizontal">
              <Switch
                checked={createBranchAndWorktree}
                onCheckedChange={setCreateBranchAndWorktree}
              />
              <FieldLabel>Create task branch and worktree</FieldLabel>
            </Field>
            {createBranchAndWorktree && (
              <Field orientation="horizontal">
                <Switch checked={pushBranch} onCheckedChange={setPushBranch} />
                <FieldLabel>Push branch to remote</FieldLabel>
              </Field>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
