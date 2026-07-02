import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import { ConversationField } from '@renderer/features/tasks/task-config/conversation-field';
import { TaskConfigProvider } from '@renderer/features/tasks/task-config/task-config-context';
import { TaskConfigPanel } from '@renderer/features/tasks/task-config/task-config-panel';
import { TaskStateProvider } from '@renderer/features/tasks/task-config/task-state-context';
import { WorkspaceSettingsSection } from '@renderer/features/tasks/task-config/workspace-settings-section';
import { CronPicker } from '@renderer/lib/CronPicker';
import { useFeatureFlag } from '@renderer/lib/hooks/useFeatureFlag';
import { Field, FieldDescription, FieldError, FieldGroup } from '@renderer/lib/ui/field';
import { Label } from '@renderer/lib/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Textarea } from '@renderer/lib/ui/textarea';
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
          <Select
            value={triggerKind ?? 'cron'}
            onValueChange={(nextKind) => {
              const typedKind = nextKind as NonNullable<AutomationFormState['triggerKind']>;
              setTriggerKind(typedKind);
              onCronErrorClear();
              onTriggerKindChange?.(typedKind);
            }}
          >
            <SelectTrigger size="sm" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cron">Simple schedule</SelectItem>
              <SelectItem value="rrule">Custom RRULE</SelectItem>
            </SelectContent>
          </Select>
          {(triggerKind ?? 'cron') === 'rrule' ? (
            <div className="flex flex-col gap-2">
              <Textarea
                value={rruleExpr}
                onChange={(event) => {
                  setRRuleExpr(event.target.value);
                  onCronErrorClear();
                }}
                onBlur={onRRuleExprBlur}
                spellCheck={false}
                className="min-h-24 font-mono text-xs"
                placeholder={'DTSTART:20260706T090000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO'}
              />
              <FieldDescription>
                Example: <code>DTSTART:20260706T090000Z</code> +{' '}
                <code>RRULE:FREQ=WEEKLY;BYDAY=MO</code> runs every Monday at 09:00 UTC.
              </FieldDescription>
            </div>
          ) : (
            <CronPicker
              value={cronExpr}
              onChange={(nextCronExpr) => {
                onCronExprChange(nextCronExpr);
                onCronErrorClear();
              }}
            />
          )}
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
