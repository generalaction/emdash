import { useState } from 'react';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Label } from '@renderer/lib/ui/label';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';
import { Switch } from '@renderer/lib/ui/switch';
import { BranchPickerField } from './branch-picker-field';
import { CheckoutModeGroup } from './checkout-mode-group';
import type { CreateTaskState } from './use-create-task-state';

type WorkspaceMode = 'new' | 'existing';

interface WorkspaceSettingsSectionProps {
  state: CreateTaskState;
  projectId?: string;
  currentBranch?: string | null;
  isUnborn?: boolean;
  useBYOI: boolean;
  setUseBYOI: (value: boolean) => void;
  isWorkspaceProviderEnabled: boolean;
}

export function WorkspaceSettingsSection({
  state,
  projectId,
  currentBranch,
  isUnborn,
  useBYOI,
  setUseBYOI,
  isWorkspaceProviderEnabled,
}: WorkspaceSettingsSectionProps) {
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('new');

  const showPrWorkspace = state.linkedType === 'pr' && state.linkedPR !== null;

  return (
    <div className="flex flex-col gap-4">
      <RadioGroup value={workspaceMode} onValueChange={(v) => setWorkspaceMode(v as WorkspaceMode)}>
        <Label className="flex cursor-pointer items-center gap-3 font-normal">
          <RadioGroupItem value="new" />
          Create new workspace
        </Label>
        <Label className="flex cursor-pointer items-center gap-3 font-normal text-foreground-muted">
          <RadioGroupItem value="existing" disabled />
          Select existing workspace
        </Label>
      </RadioGroup>

      {workspaceMode === 'new' &&
        (showPrWorkspace ? (
          <CheckoutModeGroup
            value={state.checkoutMode}
            onValueChange={state.setCheckoutMode}
            pushBranch={state.branchSelection.pushBranch}
            onPushBranchChange={state.branchSelection.setPushBranch}
          />
        ) : (
          <BranchPickerField
            state={state.branchSelection}
            branchNameState={state.branchNameState}
            projectId={projectId}
            currentBranch={currentBranch}
            isUnborn={isUnborn}
          />
        ))}

      {isWorkspaceProviderEnabled && (
        <Field orientation="horizontal">
          <Switch size="sm" checked={useBYOI} onCheckedChange={setUseBYOI} />
          <FieldLabel>Run on own infrastructure</FieldLabel>
        </Field>
      )}
    </div>
  );
}
