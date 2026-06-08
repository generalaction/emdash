import { ChevronDown, FolderOpen, GitBranch } from 'lucide-react';
import { InitialConversationField } from '@renderer/features/tasks/conversations/initial-conversation-section';
import { BranchNameField } from '@renderer/features/tasks/create-task-modal/branch-name-field';
import {
  ExistingWorkspacePicker,
  useProjectWorkspaces,
} from '@renderer/features/tasks/create-task-modal/existing-workspace-picker';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import { SetupStepPreview } from '@renderer/features/tasks/create-task-modal/setup-step-preview';
import { WorkspacePresetPicker } from '@renderer/features/tasks/create-task-modal/workspace-preset-picker';
import { ProjectBranchSelector } from '@renderer/lib/components/project-branch-selector';
import { CronPicker } from '@renderer/lib/CronPicker';
import { useFeatureFlag } from '@renderer/lib/hooks/useFeatureFlag';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import { Field, FieldError, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Label } from '@renderer/lib/ui/label';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';
import { Switch } from '@renderer/lib/ui/switch';
import type { AutomationFormState } from '../useAutomationFormState';

interface AutomationSettingsFieldsProps {
  state: AutomationFormState;
  cronError: string | null;
  onCronExprChange: (expr: string) => void;
  onCronErrorClear: () => void;
  onPromptBlur?: () => void;
  error?: string | null;
}

export function AutomationSettingsFields({
  state,
  cronError,
  onCronExprChange,
  onCronErrorClear,
  onPromptBlur,
  error,
}: AutomationSettingsFieldsProps) {
  const {
    initialConversation,
    cronExpr,
    workspaceConfig,
    effectiveProjectId,
    isUnborn,
    setProjectId,
  } = state;

  const isWorkspaceProviderEnabled = useFeatureFlag('workspace-provider');
  const { data: existingWorkspaces = [] } = useProjectWorkspaces(effectiveProjectId);
  const workspaceSettingsKey = `${effectiveProjectId ?? 'none'}`;

  return (
    <>
      <FieldGroup>
        <Field>
          <Label>Schedule</Label>
          <CronPicker
            value={cronExpr}
            onChange={(nextCronExpr) => {
              onCronExprChange(nextCronExpr);
              onCronErrorClear();
            }}
          />
          {cronError && <FieldError>{cronError}</FieldError>}
        </Field>
        <Field>
          <Label>Prompt</Label>
          <InitialConversationField
            state={initialConversation}
            includeIssueContextByDefault={false}
            onPromptBlur={onPromptBlur}
          />
        </Field>
        <Field>
          <Label>Workspace</Label>
          <div key={workspaceSettingsKey} className="flex flex-col gap-3">
            <WorkspacePresetPicker
              value={workspaceConfig.presetId}
              onValueChange={workspaceConfig.setPresetId}
              hasPR={false}
              isWorkspaceProviderEnabled={isWorkspaceProviderEnabled}
              hasExistingWorkspaces={existingWorkspaces.length > 0}
            />
            {workspaceConfig.presetId === 'new-worktree' && (
              <>
                <RadioGroup
                  value={
                    workspaceConfig.branchSelection.createBranchAndWorktree ? 'create' : 'checkout'
                  }
                  onValueChange={(v) =>
                    workspaceConfig.branchSelection.setCreateBranchAndWorktree(v === 'create')
                  }
                  className="grid-cols-2 gap-2"
                >
                  <Label className="has-data-checked:border-primary has-data-checked:bg-primary/5 flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <RadioGroupItem value="checkout" />
                    Checkout branch
                  </Label>
                  <Label className="has-data-checked:border-primary has-data-checked:bg-primary/5 flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <RadioGroupItem value="create" />
                    Create new branch
                  </Label>
                </RadioGroup>
                {effectiveProjectId && (
                  <ProjectBranchSelector
                    projectId={effectiveProjectId}
                    value={workspaceConfig.branchSelection.selectedBranch}
                    onValueChange={workspaceConfig.branchSelection.setSelectedBranch}
                    showRemoteSelectorFooter
                    trigger={
                      <ComboboxTrigger className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-2.5 py-2 outline-none hover:bg-background-1 data-popup-open:bg-background-1">
                        <div className="flex flex-col gap-0.5 text-left text-sm">
                          <span className="text-xs text-foreground-passive">
                            {workspaceConfig.branchSelection.createBranchAndWorktree
                              ? 'From branch'
                              : 'Branch'}
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
                {workspaceConfig.branchSelection.createBranchAndWorktree && !isUnborn && (
                  <>
                    <BranchNameField state={workspaceConfig.branchNameState} />
                    <Field orientation="horizontal">
                      <Switch
                        checked={workspaceConfig.branchSelection.pushBranch}
                        onCheckedChange={workspaceConfig.branchSelection.setPushBranch}
                      />
                      <FieldLabel>Push branch to remote</FieldLabel>
                    </Field>
                  </>
                )}
                <SetupStepPreview steps={workspaceConfig.setupSteps} />
              </>
            )}
            {workspaceConfig.presetId === 'repo-root' && (
              <p className="text-xs text-foreground-muted">
                The agent will run directly in the project's repository directory without a
                dedicated worktree.
              </p>
            )}
            {workspaceConfig.presetId === 'use-existing' && (
              <ExistingWorkspacePicker
                projectId={effectiveProjectId}
                selectedWorkspaceId={workspaceConfig.selectedWorkspaceId}
                onSelect={workspaceConfig.setSelectedWorkspaceId}
              />
            )}
            {workspaceConfig.presetId === 'sandbox' && (
              <p className="text-xs text-foreground-muted">
                A remote sandbox will be provisioned using your workspace provider script when this
                automation runs.
              </p>
            )}
          </div>
        </Field>
        <Field>
          <Label>Project</Label>
          <ProjectSelector
            value={effectiveProjectId}
            onChange={(nextProjectId) => setProjectId(nextProjectId)}
            trigger={
              <ComboboxTrigger className="hover:bg-muted/40 data-popup-open:bg-muted/40 flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 text-xs outline-none">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <FolderOpen className="text-muted-foreground size-3.5 shrink-0" />
                  <ComboboxValue placeholder="Select a project" />
                </span>
                <ChevronDown className="size-3 shrink-0 text-foreground-passive" />
              </ComboboxTrigger>
            }
          />
        </Field>
      </FieldGroup>

      {error && <p className="text-destructive text-xs">{error}</p>}
    </>
  );
}
