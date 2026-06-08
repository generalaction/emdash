import { ChevronDown, GitBranch } from 'lucide-react';
import { ProjectBranchSelector } from '@renderer/lib/components/project-branch-selector';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Label } from '@renderer/lib/ui/label';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';
import { Switch } from '@renderer/lib/ui/switch';
import { BranchNameField } from './branch-name-field';
import { ExistingWorkspacePicker, useProjectWorkspaces } from './existing-workspace-picker';
import { SetupStepPreview } from './setup-step-preview';
import type { CreateTaskState } from './use-create-task-state';
import { WorkspacePresetPicker } from './workspace-preset-picker';

interface WorkspaceSettingsSectionProps {
  state: CreateTaskState;
  projectId?: string;
  currentBranch?: string | null;
  isUnborn?: boolean;
  isWorkspaceProviderEnabled: boolean;
}

export function WorkspaceSettingsSection({
  state,
  projectId,
  isUnborn = false,
  isWorkspaceProviderEnabled,
}: WorkspaceSettingsSectionProps) {
  const { workspaceConfig } = state;
  const hasPR = state.linkedType === 'pr' && state.linkedPR !== null;
  const { data: existingWorkspaces = [] } = useProjectWorkspaces(projectId);

  const { presetId, branchSelection, branchNameState, setupSteps } = workspaceConfig;
  const { createBranchAndWorktree, setCreateBranchAndWorktree } = branchSelection;

  return (
    <div className="flex flex-col gap-4">
      <WorkspacePresetPicker
        value={presetId}
        onValueChange={workspaceConfig.setPresetId}
        hasPR={hasPR}
        isWorkspaceProviderEnabled={isWorkspaceProviderEnabled}
        hasExistingWorkspaces={existingWorkspaces.length > 0}
      />

      {/* ── Detail panel — varies per preset ─────────────────────────────── */}

      {presetId === 'new-worktree' && (
        <div className="flex flex-col gap-3">
          {/* Sub-choice: checkout vs create */}
          <RadioGroup
            value={createBranchAndWorktree ? 'create' : 'checkout'}
            onValueChange={(v) => setCreateBranchAndWorktree(v === 'create')}
            className="grid-cols-2 gap-2"
          >
            <Label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-data-checked:border-primary has-data-checked:bg-primary/5">
              <RadioGroupItem value="checkout" />
              Checkout branch
            </Label>
            <Label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-data-checked:border-primary has-data-checked:bg-primary/5">
              <RadioGroupItem value="create" />
              Create new branch
            </Label>
          </RadioGroup>

          {/* Branch selector — always visible */}
          {projectId && (
            <ProjectBranchSelector
              projectId={projectId}
              value={branchSelection.selectedBranch}
              onValueChange={branchSelection.setSelectedBranch}
              showRemoteSelectorFooter
              trigger={
                <ComboboxTrigger className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-2.5 py-2 outline-none hover:bg-background-1 data-popup-open:bg-background-1">
                  <div className="flex flex-col gap-0.5 text-left text-sm">
                    <span className="text-xs text-foreground-passive">
                      {createBranchAndWorktree ? 'From branch' : 'Branch'}
                    </span>
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
          )}

          {/* Create-only fields */}
          {createBranchAndWorktree && !isUnborn && (
            <>
              <BranchNameField state={branchNameState} />
              <Field orientation="horizontal">
                <Switch
                  checked={branchSelection.pushBranch}
                  onCheckedChange={branchSelection.setPushBranch}
                />
                <FieldLabel>Push branch to remote</FieldLabel>
              </Field>
            </>
          )}

          <SetupStepPreview steps={setupSteps} />
        </div>
      )}

      {presetId === 'repo-root' && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-foreground-muted">
            The agent will run directly in the project's repository directory without a dedicated
            worktree. Any changes will be made in the shared repository root.
          </p>
          <SetupStepPreview steps={setupSteps} />
        </div>
      )}

      {presetId === 'use-existing' && (
        <ExistingWorkspacePicker
          projectId={projectId}
          selectedWorkspaceId={workspaceConfig.selectedWorkspaceId}
          onSelect={workspaceConfig.setSelectedWorkspaceId}
        />
      )}

      {presetId === 'checkout-pr' && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-foreground-muted">
            The PR branch will be fetched and checked out in a dedicated worktree. No new branch
            will be created.
          </p>
          <SetupStepPreview steps={setupSteps} />
        </div>
      )}

      {presetId === 'pr-new-branch' && (
        <div className="flex flex-col gap-3">
          <BranchNameField state={branchNameState} />
          <Field orientation="horizontal">
            <Switch
              checked={branchSelection.pushBranch}
              onCheckedChange={branchSelection.setPushBranch}
            />
            <FieldLabel>Push branch to remote</FieldLabel>
          </Field>
          <SetupStepPreview steps={setupSteps} />
        </div>
      )}

      {presetId === 'sandbox' && (
        <p className="text-xs text-foreground-muted">
          A remote sandbox will be provisioned using your workspace provider script when this task
          starts.
        </p>
      )}
    </div>
  );
}
