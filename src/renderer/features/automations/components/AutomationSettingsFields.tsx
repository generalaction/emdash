import { ChevronDown, FolderOpen } from 'lucide-react';
import { InitialConversationField } from '@renderer/features/tasks/conversations/initial-conversation-section';
import { BranchPickerField } from '@renderer/features/tasks/create-task-modal/branch-picker-field';
import {
  ExistingWorkspacePicker,
  useProjectWorkspaces,
} from '@renderer/features/tasks/create-task-modal/existing-workspace-picker';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import { SetupStepPreview } from '@renderer/features/tasks/create-task-modal/setup-step-preview';
import { WorkspaceModePicker } from '@renderer/features/tasks/create-task-modal/workspace-mode-picker';
import { CronPicker } from '@renderer/lib/CronPicker';
import { useFeatureFlag } from '@renderer/lib/hooks/useFeatureFlag';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import { Field, FieldError, FieldGroup } from '@renderer/lib/ui/field';
import { Label } from '@renderer/lib/ui/label';
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
    currentBranch,
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
            <WorkspaceModePicker
              value={workspaceConfig.mode}
              onValueChange={workspaceConfig.setMode}
              hasExistingWorkspaces={existingWorkspaces.length > 0}
              isWorkspaceProviderEnabled={isWorkspaceProviderEnabled}
              isUnborn={isUnborn}
            />
            {workspaceConfig.mode === 'existing' && (
              <ExistingWorkspacePicker
                projectId={effectiveProjectId}
                selectedWorkspaceId={workspaceConfig.selectedWorkspaceId}
                onSelect={workspaceConfig.setSelectedWorkspaceId}
              />
            )}
            {workspaceConfig.mode === 'new-worktree' && (
              <>
                <BranchPickerField
                  state={workspaceConfig.branchSelection}
                  branchNameState={workspaceConfig.branchNameState}
                  projectId={effectiveProjectId}
                  currentBranch={currentBranch}
                  isUnborn={isUnborn}
                />
                <SetupStepPreview steps={workspaceConfig.setupSteps} />
              </>
            )}
            {workspaceConfig.mode === 'sandbox' && (
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
