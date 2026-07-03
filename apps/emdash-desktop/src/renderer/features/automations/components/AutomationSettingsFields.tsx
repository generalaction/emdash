import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import { ConversationField } from '@renderer/features/tasks/task-config/conversation-field';
import { TaskConfigProvider } from '@renderer/features/tasks/task-config/task-config-context';
import { TaskConfigPanel } from '@renderer/features/tasks/task-config/task-config-panel';
import { TaskStateProvider } from '@renderer/features/tasks/task-config/task-state-context';
import { WorkspaceSettingsSection } from '@renderer/features/tasks/task-config/workspace-settings-section';
import { CronPicker } from '@renderer/lib/CronPicker';
import { useFeatureFlag } from '@renderer/lib/hooks/useFeatureFlag';
import { Field, FieldError, FieldGroup } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import type { AutomationFormState } from '../useAutomationFormState';

interface AutomationSettingsFieldsProps {
  state: AutomationFormState;
  cronError: string | null;
  onCronExprChange: (expr: string) => void;
  onCronErrorClear: () => void;
  onTriggerKindChange?: (kind: NonNullable<AutomationFormState['triggerKind']>) => void;
  onRRuleExprBlur?: () => void;
  onPromptBlur?: () => void;
  error?: string | null;
}

export function AutomationSettingsFields({
  state,
  cronError,
  onCronExprChange,
  onCronErrorClear,
  onTriggerKindChange,
  onRRuleExprBlur,
  onPromptBlur,
  error,
}: AutomationSettingsFieldsProps) {
  const {
    initialConversation,
    triggerKind,
    setTriggerKind,
    cronExpr,
    rruleExpr,
    setRRuleExpr,
    workspaceConfig,
    effectiveProjectId,
    isUnborn,
    setProjectId,
  } = state;

  const isWorkspaceProviderEnabled = useFeatureFlag('workspace-provider');

  return (
    <>
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
              setTriggerKind('cron');
              onCronExprChange(nextCronExpr);
              onCronErrorClear();
            }}
            custom={{
              selected: (triggerKind ?? 'cron') === 'rrule',
              onSelect: () => {
                setTriggerKind('rrule');
                onCronErrorClear();
                onTriggerKindChange?.('rrule');
              },
              content: (
                <Input
                  value={rruleExpr}
                  onChange={(event) => {
                    setRRuleExpr(event.target.value);
                    onCronErrorClear();
                  }}
                  onBlur={onRRuleExprBlur}
                  spellCheck={false}
                  className="h-7 min-w-0 flex-1 font-mono text-xs"
                  placeholder="RRULE"
                />
              ),
            }}
          />
          {cronError && <FieldError>{cronError}</FieldError>}
        </Field>
        <TaskStateProvider
          workspaceConfig={workspaceConfig}
          initialConversation={initialConversation}
          projectId={effectiveProjectId}
          isUnborn={isUnborn}
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
    </>
  );
}
