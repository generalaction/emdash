import { ChevronDown, FolderOpen } from 'lucide-react';
import { TaskConfigPanel } from '@renderer/features/tasks/task-config/task-config-panel';
import { TaskConfigProvider } from '@renderer/features/tasks/task-config/task-config-context';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
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
    isUnborn,
    setProjectId,
  } = state;

  const isWorkspaceProviderEnabled = useFeatureFlag('workspace-provider');

  return (
    <TaskConfigProvider conversationLabel="Prompt" showPrPresets={false}>
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
        <TaskConfigPanel
          workspaceConfig={workspaceConfig}
          initialConversation={initialConversation}
          onPromptBlur={onPromptBlur}
          projectId={effectiveProjectId}
          isUnborn={isUnborn}
          isWorkspaceProviderEnabled={isWorkspaceProviderEnabled}
        />
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
    </TaskConfigProvider>
  );
}
