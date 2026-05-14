import { motion } from 'framer-motion';
import {
  CalendarClock,
  ChevronDown,
  CirclePause,
  CirclePlay,
  FolderOpen,
  History,
  Loader2,
  Play,
  Trash2,
  X,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  AGENT_PROVIDER_IDS,
  isValidProviderId,
  type AgentProviderId,
} from '@shared/agent-provider-registry';
import type { ActionSpec, TaskCreateAction } from '@shared/automations/actions';
import {
  automationCatalogCategories,
  builtinAutomationCatalog,
} from '@shared/automations/builtin-catalog';
import {
  DEFAULT_SCHEDULE,
  formatAutomationError,
  formatCronLabel,
  INTERVAL_MINUTE_OPTIONS,
  parseCronToSchedule,
  SCHEDULE_KIND_LABELS,
  SCHEDULE_KIND_ORDER,
  scheduleToCron,
  WEEKDAY_LABELS,
  WEEKDAY_TOKENS,
  type ScheduleKind,
  type ScheduleSpec,
  type WeekdayToken,
} from '@shared/automations/format';
import { getLocalTimeZone } from '@shared/automations/timezone';
import {
  AUTOMATION_NAME_MAX_LENGTH,
  type Automation,
  type BuiltinAutomationTemplate,
  type TriggerSpec,
} from '@shared/automations/types';
import type { Branch } from '@shared/git';
import {
  asMounted,
  firstMountedProjectId,
  getProjectStore,
  getRepositoryStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { resolveBranchLikeTaskStrategy } from '@renderer/features/tasks/create-task-modal/create-task-strategy';
import { FromBranchContent } from '@renderer/features/tasks/create-task-modal/from-branch-content';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import {
  useFromBranchMode,
  type FromBranchModeInitial,
} from '@renderer/features/tasks/create-task-modal/use-from-branch-mode';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useFeatureFlag } from '@renderer/lib/hooks/useFeatureFlag';
import { AnimatedHeight } from '@renderer/lib/ui/animated-height';
import { Button } from '@renderer/lib/ui/button';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@renderer/lib/ui/combobox';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Spinner } from '@renderer/lib/ui/spinner';
import { Switch } from '@renderer/lib/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { useAutomationRuns, useAutomations } from '../useAutomations';
import { AutomationRunRow } from './AutomationRunRow';

const DEFAULT_CRON = scheduleToCron(DEFAULT_SCHEDULE);
const PANEL_EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_WIDTH = 480;
const RUNS_PAGE_SIZE = 15;
const PINNED_TEMPLATES = builtinAutomationCatalog.slice(0, 5);

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

function extractTaskAction(actions: ActionSpec[] | undefined): TaskCreateAction | undefined {
  return actions?.find((action): action is TaskCreateAction => action.kind === 'task.create');
}

function cronExprFromTrigger(trigger: TriggerSpec | undefined): string {
  return trigger?.kind === 'cron' ? trigger.expr : DEFAULT_CRON;
}

function cronTzFromTrigger(trigger: TriggerSpec | undefined): string {
  return trigger?.kind === 'cron' ? trigger.tz : getLocalTimeZone();
}

function branchInitialFromAction(action: TaskCreateAction | undefined): {
  createBranchAndWorktree: boolean;
  pushBranch?: boolean;
  branchOverride?: Branch;
} {
  if (!action || !action.strategy) return { createBranchAndWorktree: true };
  if (action.strategy.kind === 'new-branch') {
    return {
      createBranchAndWorktree: true,
      pushBranch: action.strategy.pushBranch,
      branchOverride: action.sourceBranch,
    };
  }
  if (action.strategy.kind === 'no-worktree') {
    return { createBranchAndWorktree: false, branchOverride: action.sourceBranch };
  }
  return { createBranchAndWorktree: true, branchOverride: action.sourceBranch };
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

interface AutomationPanelShellProps {
  open: boolean;
  children: ReactNode;
}

export function AutomationPanelShell({ open, children }: AutomationPanelShellProps) {
  return (
    <motion.aside
      initial={false}
      animate={{ width: open ? PANEL_WIDTH : 0, opacity: open ? 1 : 0 }}
      transition={{ duration: 0.28, ease: PANEL_EASE }}
      className="relative shrink-0 overflow-hidden border-l border-border bg-background"
      aria-hidden={!open}
    >
      <div
        className="absolute inset-y-0 right-0 flex h-full flex-col"
        style={{ width: PANEL_WIDTH }}
      >
        {children}
      </div>
    </motion.aside>
  );
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

  const { value: defaultAgentValue } = useAppSettingsKey('defaultAgent');
  const fallbackProvider: AgentProviderId = isValidProviderId(defaultAgentValue)
    ? defaultAgentValue
    : 'claude';

  const [name, setName] = useState(automation?.name ?? appliedTemplate?.name ?? '');
  const [prompt, setPrompt] = useState(seedTaskAction?.prompt ?? '');
  const [projectId, setProjectId] = useState<string | undefined>(
    automation?.projectId ?? firstMountedProjectId()
  );
  const [provider, setProvider] = useState<AgentProviderId>(
    seedTaskAction?.provider ?? fallbackProvider
  );
  const [cronExpr, setCronExpr] = useState<string>(cronExprFromTrigger(seedTrigger));
  const [cronTz] = useState<string>(cronTzFromTrigger(seedTrigger));
  const [useBYOI, setUseBYOI] = useState(seedTaskAction?.workspaceProvider === 'byoi');
  const [error, setError] = useState<string | null>(null);
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false);

  const effectiveProjectId =
    projectId && asMounted(getProjectStore(projectId)) ? projectId : firstMountedProjectId();

  const repo = effectiveProjectId ? getRepositoryStore(effectiveProjectId) : undefined;
  const defaultBranch = repo?.defaultBranch;
  const isUnborn = repo?.isUnborn ?? false;
  const currentBranch = repo?.currentBranch ?? null;

  const branchInitial = useMemo(() => branchInitialFromAction(seedTaskAction), [seedTaskAction]);
  const fromBranchInitial: FromBranchModeInitial = useMemo(
    () => ({ ...branchInitial, taskName: seedTaskAction?.taskName }),
    [branchInitial, seedTaskAction?.taskName]
  );

  const fromBranch = useFromBranchMode(
    effectiveProjectId,
    defaultBranch,
    isUnborn,
    currentBranch,
    fromBranchInitial
  );

  const { create, update } = useAutomations();
  const isPending = create.isPending || update.isPending;
  const isWorkspaceProviderEnabled = useFeatureFlag('workspace-provider');
  const effectiveUseBYOI = isWorkspaceProviderEnabled && useBYOI;

  const canSave =
    name.trim().length > 0 &&
    prompt.trim().length > 0 &&
    !!effectiveProjectId &&
    fromBranch.isValid &&
    !isPending;

  function buildTriggerSpec(): TriggerSpec {
    return { kind: 'cron', expr: cronExpr.trim(), tz: cronTz };
  }

  function buildTaskAction(): TaskCreateAction | null {
    if (!fromBranch.selectedBranch) return null;
    const strategy = resolveBranchLikeTaskStrategy({
      isUnborn,
      createBranchAndWorktree: fromBranch.createBranchAndWorktree,
      taskBranch: fromBranch.taskName,
      pushBranch: fromBranch.pushBranch,
    });
    return {
      kind: 'task.create',
      prompt: prompt.trim(),
      provider,
      workspaceProvider: effectiveUseBYOI ? 'byoi' : undefined,
      taskName: fromBranch.taskName,
      sourceBranch: plainBranch(fromBranch.selectedBranch),
      strategy: effectiveUseBYOI ? { kind: 'no-worktree' } : strategy,
    };
  }

  async function handleSave() {
    if (!effectiveProjectId || !canSave) return;
    setError(null);
    const action = buildTaskAction();
    if (!action) return;
    const triggerSpec = buildTriggerSpec();
    const actions: ActionSpec[] = [action];
    try {
      const trimmedName = name.trim();
      const saved = automation
        ? await update.mutateAsync({
            id: automation.id,
            patch: {
              name: trimmedName,
              trigger: triggerSpec,
              actions,
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
            projectId: effectiveProjectId,
            builtinTemplateId: appliedTemplate?.id ?? null,
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
    if (template.defaultTrigger?.kind === 'cron') {
      setCronExpr(template.defaultTrigger.expr);
    }
    setTemplatePopoverOpen(false);
  }

  return (
    <div
      className="flex h-full flex-col"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <PanelHeader
        isEdit={isEdit}
        automation={automation}
        onClose={onClose}
        onRunNow={onRunNow ? () => automation && onRunNow(automation) : undefined}
        onToggleEnabled={
          onToggleEnabled
            ? (enabled) => automation && onToggleEnabled(automation, enabled)
            : undefined
        }
        onDelete={onDelete ? () => automation && onDelete(automation) : undefined}
        runNowPending={runNowPending}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-6 px-5 py-5">
          <section className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <Label className="text-xs font-medium tracking-wide text-muted-foreground">
                Name
              </Label>
              {!isEdit && (
                <UseTemplateButton
                  open={templatePopoverOpen}
                  onOpenChange={setTemplatePopoverOpen}
                  onSelect={applyTemplate}
                />
              )}
            </div>
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
            <Label className="text-xs font-medium tracking-wide text-muted-foreground">
              Prompt
            </Label>
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

          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Schedule
            </h3>
            <div className="rounded-md border border-border bg-muted/10">
              <RowField label="Runs">
                <SchedulePicker value={cronExpr} onChange={setCronExpr} />
              </RowField>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Execution
            </h3>
            <div className="rounded-md border border-border bg-muted/10">
              <RowField label="Project">
                <ProjectSelector
                  value={effectiveProjectId}
                  onChange={setProjectId}
                  trigger={
                    <ComboboxTrigger className="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 text-xs outline-none hover:bg-muted/40 data-popup-open:bg-muted/40">
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
                        <ComboboxValue placeholder="Select a project" />
                      </span>
                      <ChevronDown className="size-3 shrink-0 text-foreground-passive" />
                    </ComboboxTrigger>
                  }
                />
              </RowField>
              <RowField label="Agent">
                <AgentPicker value={provider} onChange={setProvider} />
              </RowField>
            </div>

            {isWorkspaceProviderEnabled ? (
              <div className="flex items-center gap-2">
                <Switch size="sm" checked={useBYOI} onCheckedChange={setUseBYOI} />
                <span className="text-sm text-muted-foreground">Use BYOI infrastructure</span>
              </div>
            ) : null}

            <AnimatedHeight>
              <FromBranchContent
                state={fromBranch}
                projectId={effectiveProjectId}
                currentBranch={currentBranch}
                isUnborn={isUnborn}
              />
            </AnimatedHeight>
          </section>

          {error && <p className="text-xs text-destructive">{error}</p>}

          {isEdit && automation ? <RunsSection automation={automation} /> : null}
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

function PanelHeader({
  isEdit,
  automation,
  onClose,
  onRunNow,
  onToggleEnabled,
  onDelete,
  runNowPending,
}: {
  isEdit: boolean;
  automation: Automation | undefined;
  onClose: () => void;
  onRunNow?: () => void;
  onToggleEnabled?: (enabled: boolean) => void;
  onDelete?: () => void;
  runNowPending?: boolean;
}) {
  const enabled = automation?.enabled ?? false;

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        <h2 className="min-w-0 truncate text-sm font-semibold">
          {automation?.isDraft
            ? 'Draft automation'
            : isEdit
              ? (automation?.name ?? 'Automation')
              : 'New automation'}
        </h2>
      </div>

      {isEdit && automation ? (
        <div className="flex items-center gap-0.5">
          {onRunNow ? (
            <Tooltip>
              <TooltipTrigger
                onClick={onRunNow}
                disabled={runNowPending}
                aria-label="Run now"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                {runNowPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
              </TooltipTrigger>
              <TooltipContent>Run now</TooltipContent>
            </Tooltip>
          ) : null}
          {onToggleEnabled ? (
            <Tooltip>
              <TooltipTrigger
                onClick={() => onToggleEnabled(!enabled)}
                aria-label={enabled ? 'Pause' : 'Resume'}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {enabled ? <CirclePause className="size-4" /> : <CirclePlay className="size-4" />}
              </TooltipTrigger>
              <TooltipContent>{enabled ? 'Pause' : 'Resume'}</TooltipContent>
            </Tooltip>
          ) : null}
          {onDelete ? (
            <Tooltip>
              <TooltipTrigger
                onClick={onDelete}
                aria-label="Delete automation"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RowField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-border last:border-b-0 px-3 py-2">
      <span className="w-20 shrink-0 text-xs font-medium text-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function UseTemplateButton({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: BuiltinAutomationTemplate) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5',
          'text-xs font-medium text-foreground transition-colors hover:bg-muted/40 outline-none',
          'data-popup-open:bg-muted/40'
        )}
      >
        Use template
        <ChevronDown className="size-3 shrink-0 text-foreground-passive" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Pinned templates
        </div>
        {PINNED_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => onSelect(template)}
            className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
          >
            <span className="text-sm font-medium text-foreground">{template.name}</span>
            {template.description ? (
              <span className="line-clamp-1 text-xs text-muted-foreground">
                {template.description}
              </span>
            ) : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function RunsSection({ automation }: { automation: Automation }) {
  const [visibleLimit, setVisibleLimit] = useState(RUNS_PAGE_SIZE);
  const runs = useAutomationRuns(automation.id, visibleLimit + 1);
  const visibleRuns = useMemo(
    () => runs.data?.slice(0, visibleLimit) ?? [],
    [runs.data, visibleLimit]
  );
  const hasMore = Boolean(runs.data && runs.data.length > visibleLimit);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Run history
        </h3>
        <History className="size-3.5 text-muted-foreground" />
      </div>
      {runs.isPending ? (
        <div className="flex h-24 items-center justify-center">
          <Spinner />
        </div>
      ) : visibleRuns.length > 0 ? (
        <div className="divide-y divide-border/70 overflow-hidden rounded-md border border-border">
          {visibleRuns.map((run) => (
            <AutomationRunRow
              key={run.id}
              run={run}
              automation={automation}
              projectId={automation.projectId}
              title={automation.name}
              paddingClass="px-3"
            />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          No runs yet.
        </div>
      )}
      {hasMore ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={runs.isFetching}
          onClick={() => setVisibleLimit((limit) => limit + RUNS_PAGE_SIZE)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {runs.isFetching ? 'Loading older runs…' : 'Load older runs'}
        </Button>
      ) : null}
    </section>
  );
}

const PILL_TRIGGER_CLASS =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs ' +
  'text-foreground hover:bg-muted/40 outline-none data-popup-open:bg-muted/40';

function clampInt(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function changeScheduleKind(prev: ScheduleSpec, kind: ScheduleKind): ScheduleSpec {
  const hour = prev.kind === 'interval' || prev.kind === 'hourly' ? 9 : prev.hour;
  const minute = prev.kind === 'interval' ? 0 : prev.minute;
  switch (kind) {
    case 'daily':
    case 'weekdays':
    case 'weekends':
      return { kind, hour, minute };
    case 'weekly': {
      const weekday = prev.kind === 'weekly' ? prev.weekday : 'MON';
      return { kind, hour, minute, weekday };
    }
    case 'hourly':
      return { kind, minute };
    case 'interval': {
      const intervalMinutes =
        prev.kind === 'interval' ? prev.intervalMinutes : INTERVAL_MINUTE_OPTIONS[3];
      return { kind, intervalMinutes };
    }
  }
}

function formatTimeValue(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

function SchedulePicker({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [open, setOpen] = useState(false);
  const schedule = useMemo<ScheduleSpec>(
    () => parseCronToSchedule(value) ?? DEFAULT_SCHEDULE,
    [value]
  );
  const label = useMemo(() => formatCronLabel(value), [value]);

  function update(next: ScheduleSpec) {
    onChange(scheduleToCron(next));
  }

  function handleTimeChange(event: ChangeEvent<HTMLInputElement>) {
    if (
      schedule.kind !== 'daily' &&
      schedule.kind !== 'weekdays' &&
      schedule.kind !== 'weekends' &&
      schedule.kind !== 'weekly'
    ) {
      return;
    }
    const [rawHour, rawMinute] = event.target.value.split(':');
    const hour = clampInt(parseInt(rawHour ?? '', 10), 0, 23);
    const minute = clampInt(parseInt(rawMinute ?? '', 10), 0, 59);
    update({ ...schedule, hour, minute });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={cn(PILL_TRIGGER_CLASS, 'w-full justify-between gap-1.5')}>
        <span className="flex min-w-0 items-center gap-1.5">
          <CalendarClock className="size-3.5 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className="size-3 shrink-0 text-foreground-passive" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-3 p-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Schedule</Label>
          <Select
            value={schedule.kind}
            onValueChange={(next) => {
              if (next) update(changeScheduleKind(schedule, next as ScheduleKind));
            }}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue>
                {(value) => SCHEDULE_KIND_LABELS[value as ScheduleKind] ?? ''}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} side="bottom" align="start">
              {SCHEDULE_KIND_ORDER.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {SCHEDULE_KIND_LABELS[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {schedule.kind === 'weekly' && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Day</Label>
            <Select
              value={schedule.weekday}
              onValueChange={(next) => {
                if (next) update({ ...schedule, weekday: next as WeekdayToken });
              }}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue>{(value) => WEEKDAY_LABELS[value as WeekdayToken] ?? ''}</SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} side="bottom" align="start">
                {WEEKDAY_TOKENS.map((token) => (
                  <SelectItem key={token} value={token}>
                    {WEEKDAY_LABELS[token]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {(schedule.kind === 'daily' ||
          schedule.kind === 'weekdays' ||
          schedule.kind === 'weekends' ||
          schedule.kind === 'weekly') && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Time</Label>
            <Input
              type="time"
              value={formatTimeValue(schedule.hour, schedule.minute)}
              onChange={handleTimeChange}
            />
          </div>
        )}

        {schedule.kind === 'hourly' && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Minute</Label>
            <Input
              type="number"
              min={0}
              max={59}
              value={schedule.minute}
              onChange={(event) =>
                update({
                  kind: 'hourly',
                  minute: clampInt(parseInt(event.target.value, 10), 0, 59),
                })
              }
            />
          </div>
        )}

        {schedule.kind === 'interval' && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Every</Label>
            <Select
              value={String(schedule.intervalMinutes)}
              onValueChange={(next) => {
                if (next) update({ kind: 'interval', intervalMinutes: parseInt(next, 10) });
              }}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue>{(value) => (value ? `${value} minutes` : '')}</SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} side="bottom" align="start">
                {INTERVAL_MINUTE_OPTIONS.map((minutes) => (
                  <SelectItem key={minutes} value={String(minutes)}>
                    {minutes} minutes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface PillItem<V> {
  value: V;
  label: string;
  icon?: ReactNode;
}

function AgentPicker({
  value,
  onChange,
}: {
  value: AgentProviderId;
  onChange: (next: AgentProviderId) => void;
}) {
  const items = useMemo<PillItem<AgentProviderId>[]>(
    () =>
      AGENT_PROVIDER_IDS.filter((id) => agentConfig[id]).map((id) => ({
        value: id,
        label: agentConfig[id]?.name ?? id,
      })),
    []
  );
  const selectedConfig = agentConfig[value];
  const [open, setOpen] = useState(false);
  const selected = items.find((item) => item.value === value) ?? null;
  const label = selected?.label ?? '';

  return (
    <Combobox
      items={[{ value: 'agents', items }]}
      value={selected}
      onValueChange={(item: PillItem<AgentProviderId> | null) => {
        if (item) onChange(item.value);
        setOpen(false);
      }}
      open={open}
      onOpenChange={setOpen}
      isItemEqualToValue={(a: PillItem<AgentProviderId>, b: PillItem<AgentProviderId>) =>
        a?.value === b?.value
      }
      filter={(item: PillItem<AgentProviderId>, query: string) =>
        item.label.toLowerCase().includes(query.toLowerCase())
      }
      autoHighlight
    >
      <ComboboxTrigger className={cn(PILL_TRIGGER_CLASS, 'w-full justify-between')}>
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {selectedConfig ? (
            <AgentLogo
              logo={selectedConfig.logo}
              alt={selectedConfig.alt}
              isSvg={selectedConfig.isSvg}
              invertInDark={selectedConfig.invertInDark}
              className="size-3.5 shrink-0 rounded-sm"
            />
          ) : null}
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className="size-3 shrink-0 text-foreground-passive" />
      </ComboboxTrigger>
      <ComboboxContent className="w-auto min-w-(--anchor-width)">
        <ComboboxList className="py-1">
          {(group: { value: string; items: PillItem<AgentProviderId>[] }) => (
            <ComboboxGroup key={group.value} items={group.items}>
              <ComboboxCollection>
                {(item: PillItem<AgentProviderId>) => {
                  const config = agentConfig[item.value];
                  return (
                    <ComboboxItem
                      key={String(item.value)}
                      value={item}
                      className="gap-1.5 py-1.5 pr-7 pl-2 text-xs"
                    >
                      {config ? (
                        <AgentLogo
                          logo={config.logo}
                          alt={config.alt}
                          isSvg={config.isSvg}
                          invertInDark={config.invertInDark}
                          className="size-4 shrink-0 rounded-sm"
                        />
                      ) : null}
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    </ComboboxItem>
                  );
                }}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
