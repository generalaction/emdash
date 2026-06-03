import { CheckCircle2, ChevronDown, FolderOpen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState, type ReactNode } from 'react';
import {
  asMounted,
  firstMountedProjectId,
  getProjectSshConnectionId,
  getProjectStore,
  getRepositoryStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { BranchPickerField } from '@renderer/features/tasks/create-task-modal/branch-picker-field';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import { useBranchName } from '@renderer/features/tasks/create-task-modal/use-branch-name';
import { useBranchSelection } from '@renderer/features/tasks/create-task-modal/use-branch-selection';
import { useTaskName } from '@renderer/features/tasks/create-task-modal/use-task-name';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useFeatureFlag } from '@renderer/lib/hooks/useFeatureFlag';
import { Button } from '@renderer/lib/ui/button';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';
import { isValidProviderId, type AgentProviderId } from '@shared/agent-provider-registry';
import type { TaskCreateAction } from '@shared/automations/actions';
import { automationCatalogCategories } from '@shared/automations/builtin-catalog';
import { formatAutomationError, formatCronLabel } from '@shared/automations/format';
import { DEFAULT_SCHEDULE, scheduleToCron } from '@shared/automations/schedule';
import { getLocalTimeZone } from '@shared/automations/timezone';
import {
  AUTOMATION_NAME_MAX_LENGTH,
  type Automation,
  type BuiltinAutomationTemplate,
  type CronTrigger,
} from '@shared/automations/types';
import { assertValidCronTrigger } from '@shared/automations/validation';
import type { Branch } from '@shared/git';
import type { CreateTaskParams } from '@shared/tasks';
import type { WorkspaceConfig, WorkspaceTarget } from '@shared/workspace-config';
import { useAutomations } from '../useAutomations';
import { AutomationPanelHeader } from './AutomationPanelHeader';
import { SchedulePicker } from './pickers/SchedulePicker';
import { UseTemplateButton } from './pickers/UseTemplateButton';
import { RunHistory } from './RunHistory';

const DEFAULT_CRON = scheduleToCron(DEFAULT_SCHEDULE);

export type AutomationPanelMode =
  | { kind: 'create'; template?: BuiltinAutomationTemplate }
  | { kind: 'edit'; automation: Automation };

interface AutomationPanelProps {
  mode: AutomationPanelMode;
  onClose: () => void;
  onSaved?: (automation: Automation) => void;
  onDelete?: (automation: Automation) => void;
  onRunNow?: (automation: Automation) => void;
  onToggleEnabled?: (automation: Automation, enabled: boolean) => void;
  runNowPending?: boolean;
}

function extractTaskAction(actions: TaskCreateAction[] | undefined): TaskCreateAction | undefined {
  return actions?.[0];
}

function cronExprFromTrigger(trigger: CronTrigger | undefined): string {
  return trigger?.expr ?? DEFAULT_CRON;
}

function cronTzFromTrigger(trigger: CronTrigger | undefined): string {
  return trigger?.tz ?? getLocalTimeZone();
}

/** Derives initial branch picker state from a stored task config. */
function branchInitialFromConfig(config: CreateTaskParams | null | undefined): {
  createBranchAndWorktree: boolean;
  pushBranch?: boolean;
  branchOverride?: Branch;
} {
  if (!config) return { createBranchAndWorktree: true };

  const git = config.workspaceConfig?.git;
  if (git?.kind === 'create-branch') {
    return {
      createBranchAndWorktree: true,
      pushBranch: git.pushBranch,
      branchOverride: git.fromBranch,
    };
  }
  if (git?.kind === 'none') {
    return { createBranchAndWorktree: false };
  }
  return { createBranchAndWorktree: true };
}

function plainBranch(branch: Branch): Branch {
  if (branch.type === 'remote') {
    return {
      type: 'remote',
      branch: branch.branch,
      remote: { name: branch.remote.name, url: branch.remote.url },
    };
  }
  return branch.remote
    ? {
        type: 'local',
        branch: branch.branch,
        remote: { name: branch.remote.name, url: branch.remote.url },
      }
    : { type: 'local', branch: branch.branch };
}

export const AutomationPanel = observer(function AutomationPanel({
  mode,
  onClose,
  onSaved,
  onDelete,
  onRunNow,
  onToggleEnabled,
  runNowPending,
}: AutomationPanelProps) {
  const isEdit = mode.kind === 'edit';
  const automation = mode.kind === 'edit' ? mode.automation : undefined;
  const [appliedTemplate, setAppliedTemplate] = useState<BuiltinAutomationTemplate | undefined>(
    mode.kind === 'create' ? mode.template : undefined
  );

  const seedTrigger = automation?.trigger ?? appliedTemplate?.defaultTrigger;
  const seedTaskAction = extractTaskAction(automation?.actions ?? appliedTemplate?.defaultActions);
  const seedConfig = automation?.taskConfig;

  const { value: defaultAgentValue } = useAppSettingsKey('defaultAgent');
  const fallbackProvider: AgentProviderId = isValidProviderId(defaultAgentValue)
    ? defaultAgentValue
    : 'claude';

  const [name, setName] = useState(automation?.name ?? appliedTemplate?.name ?? '');
  const [prompt, setPrompt] = useState(seedTaskAction?.prompt ?? '');
  const [projectId, setProjectId] = useState<string | undefined>(
    automation?.projectId ?? firstMountedProjectId()
  );
  const seedProvider = seedConfig?.initialConversation?.provider;
  const [provider, setProvider] = useState<AgentProviderId>(
    isValidProviderId(seedProvider) ? seedProvider : fallbackProvider
  );
  const [cronExpr, setCronExpr] = useState<string>(cronExprFromTrigger(seedTrigger));
  const [cronTz, setCronTz] = useState<string>(cronTzFromTrigger(seedTrigger));
  const [useBYOI, setUseBYOI] = useState(() => {
    const ws = seedConfig?.workspaceConfig?.workspace;
    // Support both v2 (kind='byoi') and legacy v1 (host='byoi') stored configs.
    return ws?.kind === 'byoi' || (ws as { host?: string } | undefined)?.host === 'byoi';
  });
  const [error, setError] = useState<string | null>(null);
  const [cronError, setCronError] = useState<string | null>(null);
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false);

  const effectiveProjectId =
    projectId && asMounted(getProjectStore(projectId)) ? projectId : firstMountedProjectId();
  const agentConnectionId = effectiveProjectId
    ? getProjectSshConnectionId(effectiveProjectId)
    : undefined;

  const repo = effectiveProjectId ? getRepositoryStore(effectiveProjectId) : undefined;
  const defaultBranch = repo?.defaultBranch;
  const isUnborn = repo?.isUnborn ?? false;
  const currentBranch = repo?.currentBranch ?? null;

  const branchInitial = useMemo(() => branchInitialFromConfig(seedConfig), [seedConfig]);
  const taskName = useTaskName({
    generatedName: seedConfig?.name,
    resetKey: effectiveProjectId,
  });
  const branchSelection = useBranchSelection(
    effectiveProjectId,
    defaultBranch,
    isUnborn,
    currentBranch,
    branchInitial
  );
  const branchNameState = useBranchName({
    taskName: taskName.effectiveTaskName || name,
    projectId: effectiveProjectId,
    resetKey: effectiveProjectId,
  });
  const isBranchValid =
    !branchSelection.createBranchAndWorktree ||
    (branchNameState.branchName.trim().length > 0 && !branchNameState.branchAlreadyExists);
  const isTaskConfigValid = !!branchSelection.selectedBranch && isBranchValid;

  const fromBranch = {
    selectedBranch: branchSelection.selectedBranch,
    createBranchAndWorktree: branchSelection.createBranchAndWorktree,
    pushBranch: branchSelection.pushBranch,
    branchName: branchNameState.branchName,
    taskName: taskName.effectiveTaskName,
    isValid: isTaskConfigValid,
  };

  const workspaceSettingsKey = useMemo(
    () => `${effectiveProjectId ?? 'none'}:${seedConfig?.id ?? 'new'}`,
    [effectiveProjectId, seedConfig?.id]
  );

  const { create, update } = useAutomations();
  const { toast } = useToast();
  const isPending = create.isPending || update.isPending;
  const isWorkspaceProviderEnabled = useFeatureFlag('workspace-provider');
  const effectiveUseBYOI = isWorkspaceProviderEnabled && useBYOI;

  const canSave =
    name.trim().length > 0 &&
    prompt.trim().length > 0 &&
    !!effectiveProjectId &&
    fromBranch.isValid &&
    !isPending;

  function buildTaskConfig(targetProjectId: string): CreateTaskParams | null {
    if (!fromBranch.selectedBranch) return null;

    const noWorktree = isUnborn || !fromBranch.createBranchAndWorktree || effectiveUseBYOI;
    const git = noWorktree
      ? { kind: 'none' as const }
      : {
          kind: 'create-branch' as const,
          branchName: fromBranch.branchName,
          fromBranch: plainBranch(fromBranch.selectedBranch),
          pushBranch: fromBranch.pushBranch,
        };

    let workspace: WorkspaceTarget;
    if (effectiveUseBYOI) {
      workspace = { kind: 'byoi' };
    } else if (git.kind === 'none') {
      const repositoryWorkspaceId = asMounted(getProjectStore(targetProjectId))?.data
        ?.repositoryWorkspaceId;
      workspace = repositoryWorkspaceId
        ? { kind: 'repository-instance', workspaceId: repositoryWorkspaceId }
        : { kind: 'new-worktree' };
    } else {
      workspace = { kind: 'new-worktree' };
    }

    const workspaceConfig: WorkspaceConfig = { version: '2', git, workspace };
    const taskId = crypto.randomUUID();
    return {
      id: taskId,
      projectId: targetProjectId,
      name: fromBranch.taskName?.trim() || name.trim(),
      workspaceConfig,
      initialConversation: {
        id: crypto.randomUUID(),
        projectId: targetProjectId,
        taskId,
        provider,
        title: name.trim(),
        initialPrompt: prompt.trim(),
      },
    };
  }

  function handleProjectChange(nextProjectId: string | undefined) {
    setProjectId(nextProjectId);
  }

  async function handleSave() {
    if (!effectiveProjectId || !canSave) return;
    setError(null);
    const taskConfig = buildTaskConfig(effectiveProjectId);
    if (!taskConfig) return;
    const triggerSpec: CronTrigger = { expr: cronExpr.trim(), tz: cronTz };
    try {
      assertValidCronTrigger(triggerSpec);
    } catch (validationError) {
      setCronError(formatAutomationError(validationError));
      return;
    }
    setCronError(null);
    const actions: TaskCreateAction[] = [{ kind: 'task.create', prompt: prompt.trim() }];
    try {
      const trimmedName = name.trim();
      const saved = automation
        ? await update.mutateAsync({
            id: automation.id,
            patch: {
              name: trimmedName,
              trigger: triggerSpec,
              actions,
              taskConfig,
              projectId: effectiveProjectId,
              enabled: automation.isDraft ? true : automation.enabled,
              isDraft: false,
            },
          })
        : await create.mutateAsync({
            name: trimmedName,
            description: null,
            category: appliedTemplate?.category ?? automationCatalogCategories[0],
            trigger: triggerSpec,
            actions,
            taskConfig,
            projectId: effectiveProjectId,
          });
      toast({
        title: automation ? 'Automation saved' : 'Automation created',
        description: `“${saved.name}” is ready to go.`,
        icon: <CheckCircle2 className="size-4 text-emerald-500" aria-hidden="true" />,
      });
      onSaved?.(saved);
    } catch (saveError) {
      setError(formatAutomationError(saveError));
    }
  }

  function applyTemplate(template: BuiltinAutomationTemplate) {
    setAppliedTemplate(template);
    setName(template.name);
    const action = extractTaskAction(template.defaultActions);
    setPrompt(action?.prompt ?? '');
    if (template.defaultTrigger) {
      setCronExpr(template.defaultTrigger.expr);
      setCronTz(template.defaultTrigger.tz);
      setCronError(null);
    }
    setTemplatePopoverOpen(false);
  }

  return (
    <div className="flex h-full flex-col">
      <AutomationPanelHeader
        isEdit={isEdit}
        automation={automation}
        scheduleLabel={formatCronLabel(cronExpr)}
        onClose={onClose}
        onRunNow={
          onRunNow && automation && !automation.isDraft && automation.projectId
            ? () => onRunNow(automation)
            : undefined
        }
        onToggleEnabled={
          onToggleEnabled
            ? (enabled) => automation && onToggleEnabled(automation, enabled)
            : undefined
        }
        onDelete={onDelete ? () => automation && onDelete(automation) : undefined}
        runNowPending={runNowPending}
        headerAction={
          !isEdit ? (
            <UseTemplateButton
              open={templatePopoverOpen}
              onOpenChange={setTemplatePopoverOpen}
              onSelect={applyTemplate}
            />
          ) : null
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 px-5 py-5">
          <section className="flex flex-col gap-2">
            <Label className="text-muted-foreground text-xs font-medium">Name</Label>
            <Input
              autoFocus={!isEdit && name.trim().length === 0}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void handleSave();
                }
              }}
              placeholder="Name this automation"
              maxLength={AUTOMATION_NAME_MAX_LENGTH}
              className="h-9 text-sm"
            />
          </section>

          <section className="flex flex-col gap-2">
            <Label className="text-muted-foreground text-xs font-medium">Prompt</Label>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void handleSave();
                }
              }}
              placeholder="Describe what this automation should do…"
              className={cn(
                'block w-full resize-none rounded-md border border-border bg-background',
                'px-3 py-2 text-sm placeholder:text-muted-foreground outline-none',
                'min-h-20 max-h-64 overflow-y-auto field-sizing-content focus:ring-1 focus:ring-ring'
              )}
            />
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-muted-foreground text-xs font-medium">Schedule</h3>
            <div className="bg-muted/10 rounded-md border border-border">
              <RowField label="Runs">
                <SchedulePicker
                  value={cronExpr}
                  onChange={(nextCronExpr) => {
                    setCronExpr(nextCronExpr);
                    setCronError(null);
                  }}
                />
              </RowField>
            </div>
            {cronError && <p className="text-destructive text-xs">{cronError}</p>}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-muted-foreground text-xs font-medium">Execution</h3>
            <BranchPickerField
              key={workspaceSettingsKey}
              state={branchSelection}
              branchNameState={branchNameState}
              projectId={effectiveProjectId}
              currentBranch={currentBranch}
              isUnborn={isUnborn}
            />

            <div className="bg-muted/10 rounded-md border border-border">
              <RowField label="Project">
                <ProjectSelector
                  value={effectiveProjectId}
                  onChange={handleProjectChange}
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
              </RowField>
              <RowField label="Agent">
                <AgentSelector
                  value={provider}
                  onChange={setProvider}
                  connectionId={agentConnectionId}
                  className="h-8 bg-background text-xs"
                />
              </RowField>
            </div>

            {isWorkspaceProviderEnabled ? (
              <div className="flex items-center gap-2 pt-1">
                <Switch size="sm" checked={useBYOI} onCheckedChange={setUseBYOI} />
                <span className="text-muted-foreground text-sm">Use BYOI infrastructure</span>
              </div>
            ) : null}
          </section>

          {error && <p className="text-destructive text-xs">{error}</p>}

          {isEdit && automation ? <RunHistory automation={automation} /> : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-background px-5 py-3">
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton size="sm" onClick={() => void handleSave()} disabled={!canSave}>
          {isPending
            ? 'Saving…'
            : automation?.isDraft
              ? 'Start from draft'
              : isEdit
                ? 'Save'
                : 'Create'}
        </ConfirmButton>
      </div>
    </div>
  );
});

function RowField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
      <span className="w-20 shrink-0 text-xs font-medium text-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
