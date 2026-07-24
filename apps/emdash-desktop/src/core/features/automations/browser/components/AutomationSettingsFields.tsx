import { ProjectSelector } from '@core/features/tasks/api/browser/create-task-modal/project-selector';
import { ConversationField } from '@core/features/tasks/api/browser/task-config/conversation-field';
import { TaskConfigProvider } from '@core/features/tasks/api/browser/task-config/task-config-context';
import { TaskConfigPanel } from '@core/features/tasks/api/browser/task-config/task-config-panel';
import { TaskStateProvider } from '@core/features/tasks/api/browser/task-config/task-state-context';
import { WorkspaceSettingsSection } from '@core/features/tasks/api/browser/task-config/workspace-settings-section';
import { Field, FieldError, FieldGroup } from '@core/primitives/ui/browser/field';
import { Label } from '@core/primitives/ui/browser/label';
import { CronPicker } from '@renderer/lib/CronPicker';
import { useFeatureFlag } from '@renderer/lib/hooks/useFeatureFlag';
import type { AutomationFormState } from '../useAutomationFormState';

interface AutomationSettingsFieldsProps {
  state: AutomationFormState;
  cronError: string | null;
  onCronExprChange: (expr: string) => void;
  onCronErrorClear: () => void;
  onPromptBlur?: () => void;
  error?: string | null;
  disabled?: boolean;
}

export function AutomationSettingsFields({
  state,
  cronError,
  onCronExprChange,
  onCronErrorClear,
  onPromptBlur,
  error,
  disabled = false,
}: AutomationSettingsFieldsProps) {
  const {
    initialConversation,
    cronExpr,
    workspaceConfig,
    effectiveProjectId,
    isUnborn,
    hasRepository,
    setProjectId,
  } = state;

  const isWorkspaceProviderEnabled = useFeatureFlag('workspace-provider');

  return (
    <fieldset disabled={disabled} className="contents">
      <FieldGroup>
        <Field>
          <Label>Project</Label>
          <ProjectSelector
            value={effectiveProjectId}
            onChange={(nextProjectId) => setProjectId(nextProjectId)}
          />
        </Field>
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
        <TaskStateProvider
          workspaceConfig={workspaceConfig}
          initialConversation={initialConversation}
          projectId={effectiveProjectId}
          isUnborn={isUnborn}
          hasRepository={hasRepository}
          hasPR={false}
          isWorkspaceProviderEnabled={isWorkspaceProviderEnabled}
          includeIssueContextByDefault={false}
        >
          <TaskConfigProvider showPrPresets={false} autoBranchName={true}>
            <TaskConfigPanel
              tabs={[
                {
                  value: 'prompt',
                  label: 'Prompt',
                  content: (
                    <ConversationField
                      onPromptBlur={onPromptBlur}
                      textareaClassName="min-h-40"
                      placeholder="Add a prompt to the automation..."
                      showAutoApproveToggle={false}
                      requirePromptDelivery={true}
                    />
                  ),
                },
                {
                  value: 'workspace',
                  label: 'Workspace Settings',
                  content: <WorkspaceSettingsSection defaultOpen={true} />,
                },
              ]}
            />
          </TaskConfigProvider>
        </TaskStateProvider>
      </FieldGroup>

      {error && <p className="text-destructive text-xs">{error}</p>}
    </fieldset>
  );
}
