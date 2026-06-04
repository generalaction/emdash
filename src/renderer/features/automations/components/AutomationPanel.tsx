import { Ellipsis, Trash2, CheckCircle2, ChevronDown, FolderOpen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState, type ReactNode } from 'react';
import {
  asMounted,
  firstMountedProjectId,
  getProjectStore,
  getRepositoryStore,
} from '@renderer/features/projects/stores/project-selectors';
import {
  InitialConversationField,
  useInitialConversationState,
} from '@renderer/features/tasks/conversations/initial-conversation-section';
import { BranchPickerField } from '@renderer/features/tasks/create-task-modal/branch-picker-field';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import { useBranchName } from '@renderer/features/tasks/create-task-modal/use-branch-name';
import { useBranchSelection } from '@renderer/features/tasks/create-task-modal/use-branch-selection';
import { useTaskName } from '@renderer/features/tasks/create-task-modal/use-task-name';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useFeatureFlag } from '@renderer/lib/hooks/useFeatureFlag';
import { Button } from '@renderer/lib/ui/button';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { EditableNameField } from '@renderer/lib/ui/editable-name-field';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { PanelTabs } from '@renderer/lib/ui/panel-tabs';
import { SheetFooter } from '@renderer/lib/ui/sheet';
import { Switch } from '@renderer/lib/ui/switch';
import { isValidProviderId } from '@shared/agent-provider-registry';
import type { TaskCreateAction } from '@shared/automations/actions';
import { automationCatalogCategories } from '@shared/automations/builtin-catalog';
import { formatAutomationError } from '@shared/automations/format';
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

type AutomationTab = 'runs' | 'settings';

const AUTOMATION_TABS: { value: AutomationTab; label: string }[] = [
  { value: 'runs', label: 'Runs' },
  { value: 'settings', label: 'Settings' },
];

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
  const [activeTab, setActiveTab] = useState<AutomationTab>('runs');
  const [appliedTemplate, setAppliedTemplate] = useState<BuiltinAutomationTemplate | undefined>(
    mode.kind === 'create' ? mode.template : undefined
  );

  const seedTrigger = automation?.trigger ?? appliedTemplate?.defaultTrigger;
  const seedTaskAction = extractTaskAction(automation?.actions ?? appliedTemplate?.defaultActions);
  const seedConfig = automation?.taskConfig;

  const [name, setName] = useState(automation?.name ?? appliedTemplate?.name ?? '');
  const [projectId, setProjectId] = useState<string | undefined>(
    automation?.projectId ?? firstMountedProjectId()
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

  const effectiveProjectId =
    projectId && asMounted(getProjectStore(projectId)) ? projectId : firstMountedProjectId();

  const seedProvider = isValidProviderId(seedConfig?.initialConversation?.provider)
    ? seedConfig.initialConversation.provider
    : undefined;

  const initialConversation = useInitialConversationState(effectiveProjectId, seedProvider);

  // Seed the prompt from the saved action on first render (edit mode or template).
  const [promptSeeded, setPromptSeeded] = useState(false);
  if (!promptSeeded && seedTaskAction?.prompt) {
    setPromptSeeded(true);
    initialConversation.setPrompt(seedTaskAction.prompt);
  }

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

  const prompt = initialConversation.prompt;
  const provider = initialConversation.provider ?? 'claude';

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
        description: `"${saved.name}" is ready to go.`,
        icon: <CheckCircle2 className="size-4 text-emerald-500" aria-hidden="true" />,
      });
      onSaved?.(saved);
    } catch (saveError) {
      setError(formatAutomationError(saveError));
    }
  }

  const settingsContent = (
    <>
      <section className="flex flex-col gap-2">
        <Label className="text-muted-foreground text-xs font-medium">Prompt</Label>
        <InitialConversationField
          state={initialConversation}
          includeIssueContextByDefault={false}
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
        </div>

        {isWorkspaceProviderEnabled ? (
          <div className="flex items-center gap-2 pt-1">
            <Switch size="sm" checked={useBYOI} onCheckedChange={setUseBYOI} />
            <span className="text-muted-foreground text-sm">Use BYOI infrastructure</span>
          </div>
        ) : null}
      </section>

      {error && <p className="text-destructive text-xs">{error}</p>}
    </>
  );

  return (
    <div className="flex h-full flex-col">
      <AutomationPanelHeader onClose={onClose} />

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-4">
          {isEdit && automation ? (
            <>
              <div className="flex items-center gap-2">
                <EditableNameField
                  autoFocus={false}
                  value={name}
                  onChange={setName}
                  placeholder="Name this automation"
                  maxLength={AUTOMATION_NAME_MAX_LENGTH}
                  className="flex-1"
                />
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        aria-label="More options"
                        className="text-muted-foreground hover:bg-muted rounded-md p-1 transition-colors hover:text-foreground"
                      />
                    }
                  >
                    <Ellipsis className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="bottom" align="end">
                    <DropdownMenuItem variant="destructive" onClick={() => onDelete?.(automation)}>
                      <Trash2 />
                      Delete automation
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Switch
                  size="sm"
                  checked={automation.enabled && !automation.isDraft}
                  disabled={automation.isDraft}
                  onCheckedChange={(checked) => onToggleEnabled?.(automation, checked)}
                  aria-label={automation.enabled ? 'Pause automation' : 'Enable automation'}
                />
              </div>

              <PanelTabs value={activeTab} onChange={setActiveTab} tabs={AUTOMATION_TABS} />
              {activeTab === 'runs' && <RunHistory automation={automation} />}
              {activeTab === 'settings' && settingsContent}
            </>
          ) : (
            <>
              <section className="flex flex-col gap-2">
                <Label className="text-muted-foreground text-xs font-medium">Name</Label>
                <Input
                  autoFocus={name.trim().length === 0}
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
              {settingsContent}
            </>
          )}
        </div>
      </div>
      <SheetFooter className="flex flex-row items-center justify-end gap-2">
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
      </SheetFooter>
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
