import { ChevronDown, FolderOpen } from 'lucide-react';
import { InitialConversationField } from '@renderer/features/tasks/conversations/initial-conversation-section';
import { BranchPickerField } from '@renderer/features/tasks/create-task-modal/branch-picker-field';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import { CronPicker } from '@renderer/lib/CronPicker';
import { useFeatureFlag } from '@renderer/lib/hooks/useFeatureFlag';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import { Field, FieldError, FieldGroup } from '@renderer/lib/ui/field';
import { Label } from '@renderer/lib/ui/label';
import { Switch } from '@renderer/lib/ui/switch';
import type { AutomationFormState } from '../useAutomationFormState';

interface AutomationSettingsFieldsProps {
  state: AutomationFormState;
  cronError: string | null;
  onCronExprChange: (expr: string) => void;
  onCronErrorClear: () => void;
  onPromptBlur?: () => void;
  onUseBYOIChange?: (value: boolean) => void;
  error?: string | null;
}

export function AutomationSettingsFields({
  state,
  cronError,
  onCronExprChange,
  onCronErrorClear,
  onPromptBlur,
  onUseBYOIChange,
  error,
}: AutomationSettingsFieldsProps) {
  const {
    initialConversation,
    cronExpr,
    branchSelection,
    branchNameState,
    effectiveProjectId,
    currentBranch,
    isUnborn,
    useBYOI,
    setUseBYOI,
    setProjectId,
  } = state;

  const effectiveSetUseBYOI = onUseBYOIChange ?? setUseBYOI;

  const isWorkspaceProviderEnabled = useFeatureFlag('workspace-provider');
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
          <Label>Execution</Label>
          <BranchPickerField
            key={workspaceSettingsKey}
            state={branchSelection}
            branchNameState={branchNameState}
            projectId={effectiveProjectId}
            currentBranch={currentBranch}
            isUnborn={isUnborn}
          />
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
        {isWorkspaceProviderEnabled ? (
          <div className="flex items-center gap-2 pt-1">
            <Switch size="sm" checked={useBYOI} onCheckedChange={effectiveSetUseBYOI} />
            <span className="text-muted-foreground text-sm">Use BYOI infrastructure</span>
          </div>
        ) : null}
      </FieldGroup>

      {error && <p className="text-destructive text-xs">{error}</p>}
    </>
  );
}
