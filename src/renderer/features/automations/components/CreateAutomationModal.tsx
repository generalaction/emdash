import { ChevronDown, Clock, Filter, FolderOpen, Github, Webhook, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  AGENT_PROVIDER_IDS,
  isValidProviderId,
  type AgentProviderId,
} from '@shared/agent-provider-registry';
import type { ActionSpec, TaskCreateAction } from '@shared/automations/actions';
import { automationCatalogCategories } from '@shared/automations/builtin-catalog';
import {
  isCiEventKind,
  isIssueEventKind,
  isPrEventKind,
  type AutomationEventKind,
  type EventTriggerFilters,
} from '@shared/automations/events';
import {
  DEFAULT_SCHEDULE,
  formatCronLabel,
  formatEventLabel,
  INTERVAL_MINUTE_OPTIONS,
  parseCronToSchedule,
  scheduleToCron,
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
import { getPrNumber, isForkPr, type PullRequest } from '@shared/pull-requests';
import {
  asMounted,
  getProjectManagerStore,
  getRepositoryStore,
  mountedProjectData,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  resolveBranchLikeTaskStrategy,
  resolvePullRequestTaskStrategy,
} from '@renderer/features/tasks/create-task-modal/create-task-strategy';
import { FromBranchContent } from '@renderer/features/tasks/create-task-modal/from-branch-content';
import { FromIssueContent } from '@renderer/features/tasks/create-task-modal/from-issue-content';
import { FromPrContent } from '@renderer/features/tasks/create-task-modal/from-pr-content';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import {
  useFromBranchMode,
  type FromBranchModeInitial,
} from '@renderer/features/tasks/create-task-modal/use-from-branch-mode';
import {
  useFromIssueMode,
  type FromIssueModeInitial,
} from '@renderer/features/tasks/create-task-modal/use-from-issue-mode';
import { useFromPullRequestMode } from '@renderer/features/tasks/create-task-modal/use-from-pull-request-mode';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
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
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
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
import { Separator } from '@renderer/lib/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { useAutomations } from '../useAutomations';

const DEFAULT_CRON = scheduleToCron(DEFAULT_SCHEDULE);

const GITHUB_EVENTS: readonly AutomationEventKind[] = [
  'pr.opened',
  'pr.merged',
  'pr.closed',
  'issue.opened',
] as const;

const GITHUB_EVENT_ITEMS: PillItem<AutomationEventKind>[] = GITHUB_EVENTS.map((kind) => ({
  value: kind,
  label: formatEventLabel(kind),
}));

const DEFAULT_GITHUB_EVENT: AutomationEventKind = 'pr.opened';

type TriggerKindUI = 'cron' | 'github';
type TaskStrategy = 'from-branch' | 'from-issue' | 'from-pull-request';

const TRIGGER_ITEMS: PillItem<TriggerKindUI>[] = [
  { value: 'cron', label: 'Schedule', icon: <Clock className="size-3.5 shrink-0" /> },
  { value: 'github', label: 'GitHub', icon: <Github className="size-3.5 shrink-0" /> },
];

const PILL_TRIGGER_CLASS =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs ' +
  'text-foreground hover:bg-muted/40 outline-none data-popup-open:bg-muted/40';

function firstMountedProjectId(): string | undefined {
  for (const [id, store] of getProjectManagerStore().projects.entries()) {
    if (asMounted(store)) return id;
  }
  return undefined;
}

function extractTaskAction(actions: ActionSpec[] | undefined): TaskCreateAction | undefined {
  return actions?.find((action): action is TaskCreateAction => action.kind === 'task.create');
}

function cronExprFromTrigger(trigger: TriggerSpec | undefined): string {
  return trigger?.kind === 'cron' ? trigger.expr : DEFAULT_CRON;
}

function githubEventFromTrigger(trigger: TriggerSpec | undefined): AutomationEventKind {
  return trigger?.kind === 'event' ? trigger.event : DEFAULT_GITHUB_EVENT;
}

function eventFiltersFromTrigger(trigger: TriggerSpec | undefined): EventTriggerFilters {
  if (trigger?.kind !== 'event' || !trigger.filters) return {};
  return trigger.filters;
}

function triggerKindFromSpec(trigger: TriggerSpec | undefined): TriggerKindUI {
  return trigger?.kind === 'event' ? 'github' : 'cron';
}

function strategyFromAction(action: TaskCreateAction | undefined): TaskStrategy {
  if (!action) return 'from-branch';
  if (action.linkedPullRequest || action.strategy?.kind === 'from-pull-request') {
    return 'from-pull-request';
  }
  if (action.linkedIssue) return 'from-issue';
  return 'from-branch';
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

function activeFilterCount(filters: EventTriggerFilters): number {
  let n = 0;
  if (filters.branches?.length) n++;
  if (filters.authorsInclude?.length) n++;
  if (filters.authorsExclude?.length) n++;
  return n;
}

function compactFilters(filters: EventTriggerFilters): EventTriggerFilters | undefined {
  const out: EventTriggerFilters = {};
  if (filters.branches?.length) out.branches = filters.branches;
  if (filters.authorsInclude?.length) out.authorsInclude = filters.authorsInclude;
  if (filters.authorsExclude?.length) out.authorsExclude = filters.authorsExclude;
  return Object.keys(out).length > 0 ? out : undefined;
}

function linkedPullRequestSnapshot(pr: PullRequest): TaskCreateAction['linkedPullRequest'] {
  return {
    prNumber: getPrNumber(pr) ?? 0,
    title: pr.title,
    headRefName: pr.headRefName,
    headRepositoryUrl: pr.headRepositoryUrl ?? null,
    isFork: isForkPr(pr),
    isDraft: pr.isDraft,
    status: pr.status,
  };
}

function plainBranch(branch: Branch): Branch {
  if (branch.type === 'remote') {
    return {
      type: 'remote',
      branch: branch.branch,
      remote: {
        name: branch.remote.name,
        url: branch.remote.url,
      },
    };
  }

  return branch.remote
    ? {
        type: 'local',
        branch: branch.branch,
        remote: {
          name: branch.remote.name,
          url: branch.remote.url,
        },
      }
    : {
        type: 'local',
        branch: branch.branch,
      };
}

export type CreateAutomationModalArgs = {
  template?: BuiltinAutomationTemplate;
  automation?: Automation;
};

type Props = BaseModalProps<Automation> & CreateAutomationModalArgs;

export const CreateAutomationModal = observer(function CreateAutomationModal({
  template,
  automation,
  onSuccess,
  onClose,
}: Props) {
  const seedTrigger = automation?.trigger ?? template?.defaultTrigger;
  const seedTaskAction = extractTaskAction(automation?.actions ?? template?.defaultActions);

  const { value: defaultAgentValue } = useAppSettingsKey('defaultAgent');
  const fallbackProvider: AgentProviderId = isValidProviderId(defaultAgentValue)
    ? defaultAgentValue
    : 'claude';

  const [name, setName] = useState(automation?.name ?? template?.name ?? '');
  const [prompt, setPrompt] = useState(seedTaskAction?.prompt ?? '');
  const [projectId, setProjectId] = useState<string | undefined>(
    automation?.projectId ?? firstMountedProjectId()
  );
  const [provider, setProvider] = useState<AgentProviderId>(
    seedTaskAction?.provider ?? fallbackProvider
  );
  const [triggerKind, setTriggerKind] = useState<TriggerKindUI>(triggerKindFromSpec(seedTrigger));
  const [cronExpr, setCronExpr] = useState<string>(cronExprFromTrigger(seedTrigger));
  const [githubEvent, setGithubEvent] = useState<AutomationEventKind>(
    githubEventFromTrigger(seedTrigger)
  );
  const [eventFilters, setEventFilters] = useState<EventTriggerFilters>(
    eventFiltersFromTrigger(seedTrigger)
  );
  const [selectedStrategy, setSelectedStrategy] = useState<TaskStrategy>(
    strategyFromAction(seedTaskAction)
  );
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedMountedProject = projectId
    ? asMounted(getProjectManagerStore().projects.get(projectId))
    : undefined;
  const effectiveProjectId = selectedMountedProject ? projectId : firstMountedProjectId();

  const repo = effectiveProjectId ? getRepositoryStore(effectiveProjectId) : undefined;
  const defaultBranch = repo?.defaultBranch;
  const isUnborn = repo?.isUnborn ?? false;
  const currentBranch = repo?.currentBranch ?? null;
  const projectData = effectiveProjectId
    ? mountedProjectData(getProjectManagerStore().projects.get(effectiveProjectId))
    : null;
  const repositoryUrl = repo?.repositoryUrl ?? undefined;

  const branchInitial = useMemo(() => branchInitialFromAction(seedTaskAction), [seedTaskAction]);
  const fromBranchInitial: FromBranchModeInitial = useMemo(
    () => ({ ...branchInitial, taskName: seedTaskAction?.taskName }),
    [branchInitial, seedTaskAction?.taskName]
  );
  const fromIssueInitial: FromIssueModeInitial = useMemo(
    () => ({
      ...branchInitial,
      taskName: seedTaskAction?.taskName,
      linkedIssue: seedTaskAction?.linkedIssue,
    }),
    [branchInitial, seedTaskAction?.taskName, seedTaskAction?.linkedIssue]
  );

  const fromBranch = useFromBranchMode(
    effectiveProjectId,
    defaultBranch,
    isUnborn,
    currentBranch,
    fromBranchInitial
  );
  const fromIssue = useFromIssueMode(
    effectiveProjectId,
    defaultBranch,
    isUnborn,
    currentBranch,
    fromIssueInitial
  );
  const fromPR = useFromPullRequestMode(effectiveProjectId, defaultBranch, isUnborn);

  const fromPrUnavailable = selectedStrategy === 'from-pull-request' && !repositoryUrl;
  const activeMode = {
    'from-branch': fromBranch,
    'from-issue': fromIssue,
    'from-pull-request': fromPR,
  }[selectedStrategy];

  const { create, update } = useAutomations();
  const isEdit = Boolean(automation);
  const isPending = create.isPending || update.isPending;

  const eventLabel = useMemo(() => formatEventLabel(githubEvent), [githubEvent]);
  const canSave =
    name.trim().length > 0 &&
    prompt.trim().length > 0 &&
    !!effectiveProjectId &&
    activeMode.isValid &&
    !fromPrUnavailable &&
    !isPending;

  function buildTriggerSpec(): TriggerSpec {
    if (triggerKind === 'cron') {
      return { kind: 'cron', expr: cronExpr.trim(), tz: getLocalTimeZone() };
    }
    const compact = compactFilters(eventFilters);
    return {
      kind: 'event',
      event: githubEvent,
      ...(compact ? { filters: compact } : {}),
    };
  }

  function buildTaskAction(): TaskCreateAction | null {
    const base: TaskCreateAction = {
      kind: 'task.create',
      prompt: prompt.trim(),
      provider,
    };

    switch (selectedStrategy) {
      case 'from-branch': {
        if (!fromBranch.selectedBranch) return null;
        const strategy = resolveBranchLikeTaskStrategy({
          isUnborn,
          createBranchAndWorktree: fromBranch.createBranchAndWorktree,
          taskBranch: fromBranch.taskName,
          pushBranch: fromBranch.pushBranch,
        });
        return {
          ...base,
          taskName: fromBranch.taskName,
          sourceBranch: plainBranch(fromBranch.selectedBranch),
          strategy,
        };
      }
      case 'from-issue': {
        if (!fromIssue.selectedBranch || !fromIssue.linkedIssue) return null;
        const strategy = resolveBranchLikeTaskStrategy({
          isUnborn,
          createBranchAndWorktree: fromIssue.createBranchAndWorktree,
          taskBranch: fromIssue.taskName,
          pushBranch: fromIssue.pushBranch,
        });
        return {
          ...base,
          taskName: fromIssue.taskName,
          sourceBranch: plainBranch(fromIssue.selectedBranch),
          strategy,
          linkedIssue: fromIssue.linkedIssue,
        };
      }
      case 'from-pull-request': {
        if (!fromPR.linkedPR) return null;
        const reviewBranch = fromPR.linkedPR.headRefName;
        const strategy = resolvePullRequestTaskStrategy({
          checkoutMode: fromPR.checkoutMode,
          prNumber: getPrNumber(fromPR.linkedPR) ?? 0,
          headBranch: reviewBranch,
          headRepositoryUrl: fromPR.linkedPR.headRepositoryUrl,
          isFork: isForkPr(fromPR.linkedPR),
          taskBranch: fromPR.taskName,
          pushBranch: fromPR.branchSelection.pushBranch,
        });
        return {
          ...base,
          taskName: fromPR.taskName,
          sourceBranch: { type: 'local', branch: reviewBranch },
          strategy,
          linkedPullRequest: linkedPullRequestSnapshot(fromPR.linkedPR),
        };
      }
    }
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
            },
          })
        : await create.mutateAsync({
            name: trimmedName,
            description: null,
            category: template?.category ?? automationCatalogCategories[0],
            trigger: triggerSpec,
            actions,
            projectId: effectiveProjectId,
            builtinTemplateId: template?.id ?? null,
          });
      onSuccess(saved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit automation' : 'New automation'}</DialogTitle>
      </DialogHeader>
      <DialogContentArea>
        <FieldGroup>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>Project</FieldLabel>
              <ProjectSelector
                value={effectiveProjectId}
                onChange={setProjectId}
                trigger={
                  <ComboboxTrigger className="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 text-sm outline-none hover:bg-muted/40 data-popup-open:bg-muted/40">
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
                      <ComboboxValue placeholder="Select a project" />
                    </span>
                    <ChevronDown className="size-3 shrink-0 text-foreground-passive" />
                  </ComboboxTrigger>
                }
              />
            </Field>
            <Field>
              <FieldLabel>Name</FieldLabel>
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
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>Trigger</FieldLabel>
              <ComboboxPill
                items={TRIGGER_ITEMS}
                value={triggerKind}
                onChange={setTriggerKind}
                triggerClassName="w-full justify-between"
              />
            </Field>

            {triggerKind === 'cron' ? (
              <Field>
                <FieldLabel>Schedule</FieldLabel>
                <SchedulePicker value={cronExpr} onChange={setCronExpr} />
              </Field>
            ) : (
              <Field>
                <FieldLabel>Event</FieldLabel>
                <ComboboxPill
                  items={GITHUB_EVENT_ITEMS}
                  value={githubEvent}
                  onChange={setGithubEvent}
                  triggerIcon={<Webhook className="size-3.5 shrink-0" />}
                  triggerLabel={eventLabel}
                  triggerClassName="w-full justify-between"
                />
              </Field>
            )}
          </div>

          <AnimatedHeight>
            {triggerKind === 'github' ? (
              <Field>
                <FieldLabel>Filters</FieldLabel>
                <FilterPill
                  eventKind={githubEvent}
                  value={eventFilters}
                  onChange={setEventFilters}
                />
              </Field>
            ) : null}
          </AnimatedHeight>

          <Separator className="my-1" />

          <ToggleGroup
            className="w-full"
            value={[selectedStrategy]}
            onValueChange={([value]) => {
              if (value) setSelectedStrategy(value as TaskStrategy);
            }}
          >
            <ToggleGroupItem className="flex-1" value="from-branch">
              From Branch
            </ToggleGroupItem>
            <ToggleGroupItem className="flex-1" value="from-issue">
              From Issue
            </ToggleGroupItem>
            <ToggleGroupItem className="flex-1" value="from-pull-request">
              From Pull Request
            </ToggleGroupItem>
          </ToggleGroup>

          <AnimatedHeight onAnimatingChange={setIsTransitioning}>
            {selectedStrategy === 'from-branch' && (
              <FromBranchContent
                state={fromBranch}
                projectId={effectiveProjectId}
                currentBranch={currentBranch}
                isUnborn={isUnborn}
              />
            )}
            {selectedStrategy === 'from-issue' && (
              <FromIssueContent
                state={fromIssue}
                projectId={effectiveProjectId}
                currentBranch={currentBranch}
                repositoryUrl={repositoryUrl}
                projectPath={projectData?.path}
                disabled={isTransitioning}
                isUnborn={isUnborn}
              />
            )}
            {selectedStrategy === 'from-pull-request' && (
              <div className="flex flex-col gap-3">
                {!repositoryUrl && (
                  <p className="text-sm text-muted-foreground">
                    Pull requests are currently available only for configured GitHub remotes.
                  </p>
                )}
                <FromPrContent
                  state={fromPR}
                  projectId={effectiveProjectId}
                  repositoryUrl={repositoryUrl}
                  disabled={isTransitioning || fromPrUnavailable}
                />
              </div>
            )}
          </AnimatedHeight>

          <Field>
            <FieldLabel>Agent</FieldLabel>
            <AgentPicker value={provider} onChange={setProvider} />
          </Field>

          <Field>
            <FieldLabel>Prompt</FieldLabel>
            <textarea
              autoFocus={name.trim().length > 0}
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
                'min-h-24 max-h-64 overflow-y-auto field-sizing-content focus:ring-1 focus:ring-ring'
              )}
            />
          </Field>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton onClick={() => void handleSave()} disabled={!canSave}>
          {isPending ? 'Saving…' : isEdit ? 'Save' : 'Create'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});

const WEEKDAY_LABELS: Record<WeekdayToken, string> = {
  SUN: 'Sunday',
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
};

const SCHEDULE_KIND_LABELS: Record<ScheduleKind, string> = {
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekends: 'Weekends',
  weekly: 'Weekly',
  hourly: 'Hourly',
  interval: 'Every N minutes',
};

const SCHEDULE_KIND_ORDER: readonly ScheduleKind[] = [
  'daily',
  'weekdays',
  'weekends',
  'weekly',
  'hourly',
  'interval',
];

function clampInt(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function changeScheduleKind(prev: ScheduleSpec, kind: ScheduleKind): ScheduleSpec {
  const hour = prev.kind === 'interval' ? 9 : prev.kind === 'hourly' ? 9 : prev.hour;
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

interface SchedulePickerProps {
  value: string;
  onChange: (next: string) => void;
}

function SchedulePicker({ value, onChange }: SchedulePickerProps) {
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
      <PopoverTrigger className={cn(PILL_TRIGGER_CLASS, 'w-full justify-between')}>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="size-3.5 shrink-0" />
          <span>{label}</span>
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

interface ComboboxPillProps<V extends string> {
  items: PillItem<V>[];
  value: V;
  onChange: (next: V) => void;
  triggerIcon?: ReactNode;
  triggerLabel?: string;
  triggerClassName?: string;
  groupKey?: string;
  renderItem?: (item: PillItem<V>) => ReactNode;
}

function ComboboxPill<V extends string>({
  items,
  value,
  onChange,
  triggerIcon,
  triggerLabel,
  triggerClassName,
  groupKey = 'items',
  renderItem,
}: ComboboxPillProps<V>) {
  const [open, setOpen] = useState(false);
  const selected = items.find((item) => item.value === value) ?? null;
  const label = triggerLabel ?? selected?.label ?? '';
  const icon = triggerIcon ?? selected?.icon ?? null;

  return (
    <Combobox
      items={[{ value: groupKey, items }]}
      value={selected}
      onValueChange={(item: PillItem<V> | null) => {
        if (item) onChange(item.value);
        setOpen(false);
      }}
      open={open}
      onOpenChange={setOpen}
      isItemEqualToValue={(a: PillItem<V>, b: PillItem<V>) => a?.value === b?.value}
      filter={(item: PillItem<V>, query) => item.label.toLowerCase().includes(query.toLowerCase())}
      autoHighlight
    >
      <ComboboxTrigger className={cn(PILL_TRIGGER_CLASS, triggerClassName)}>
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {icon}
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className="size-3 shrink-0 text-foreground-passive" />
      </ComboboxTrigger>
      <ComboboxContent className="w-auto min-w-(--anchor-width)">
        <ComboboxList className="py-1">
          {(group: { value: string; items: PillItem<V>[] }) => (
            <ComboboxGroup key={group.value} items={group.items}>
              <ComboboxCollection>
                {(item: PillItem<V>) => (
                  <ComboboxItem
                    key={String(item.value)}
                    value={item}
                    className="gap-1.5 py-1.5 pr-7 pl-2 text-xs [&_svg:not([class*='size-'])]:size-3.5"
                  >
                    {renderItem ? (
                      renderItem(item)
                    ) : (
                      <>
                        {item.icon}
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      </>
                    )}
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

interface AgentPickerProps {
  value: AgentProviderId;
  onChange: (next: AgentProviderId) => void;
}

function AgentPicker({ value, onChange }: AgentPickerProps) {
  const items = useMemo<PillItem<AgentProviderId>[]>(
    () =>
      AGENT_PROVIDER_IDS.filter((id) => agentConfig[id]).map((id) => ({
        value: id,
        label: agentConfig[id]?.name ?? id,
      })),
    []
  );
  const selectedConfig = agentConfig[value];

  return (
    <ComboboxPill
      items={items}
      value={value}
      onChange={onChange}
      groupKey="agents"
      triggerClassName="w-full justify-between"
      triggerIcon={
        selectedConfig ? (
          <AgentLogo
            logo={selectedConfig.logo}
            alt={selectedConfig.alt}
            isSvg={selectedConfig.isSvg}
            invertInDark={selectedConfig.invertInDark}
            className="size-3.5 shrink-0 rounded-sm"
          />
        ) : null
      }
      renderItem={(item) => {
        const config = agentConfig[item.value];
        return (
          <>
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
          </>
        );
      }}
    />
  );
}

interface FilterPillProps {
  eventKind: AutomationEventKind;
  value: EventTriggerFilters;
  onChange: (next: EventTriggerFilters) => void;
}

function FilterPill({ eventKind, value, onChange }: FilterPillProps) {
  const [open, setOpen] = useState(false);
  const showBranches = isPrEventKind(eventKind) || isCiEventKind(eventKind);
  const showAuthors = isPrEventKind(eventKind) || isIssueEventKind(eventKind);
  const count = activeFilterCount(value);

  const label = count === 0 ? 'Add filter' : count === 1 ? '1 filter' : `${count} filters`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          PILL_TRIGGER_CLASS,
          'w-full justify-between',
          count === 0 && 'text-foreground-passive border-dashed'
        )}
      >
        <span className="inline-flex items-center gap-1.5">
          <Filter className="size-3.5 shrink-0" />
          <span>{label}</span>
        </span>
        <ChevronDown className="size-3 shrink-0 text-foreground-passive" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-3 p-3">
        {showBranches && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Base branches</Label>
            <TagInput
              value={value.branches ?? []}
              onChange={(branches) => onChange({ ...value, branches })}
              placeholder="e.g. main, feature/*"
            />
            <span className="text-foreground-passive text-[11px]">
              Glob patterns. Empty matches all.
            </span>
          </div>
        )}
        {showAuthors && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Only from authors</Label>
              <TagInput
                value={value.authorsInclude ?? []}
                onChange={(authorsInclude) => onChange({ ...value, authorsInclude })}
                placeholder="GitHub username"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Exclude authors</Label>
              <TagInput
                value={value.authorsExclude ?? []}
                onChange={(authorsExclude) => onChange({ ...value, authorsExclude })}
                placeholder="GitHub username"
              />
            </div>
          </>
        )}
        {!showBranches && !showAuthors && (
          <span className="text-foreground-passive text-xs">
            No filters available for this event.
          </span>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface TagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}

function TagInput({ value, onChange, placeholder }: TagInputProps) {
  const [draft, setDraft] = useState('');

  function commit(): void {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) {
      setDraft('');
      return;
    }
    onChange([...value, trimmed]);
    setDraft('');
  }

  function removeAt(index: number): void {
    onChange(value.filter((_, i) => i !== index));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      event.preventDefault();
      removeAt(value.length - 1);
    }
  }

  return (
    <div
      className={cn(
        'border-border bg-background flex min-h-8 flex-wrap items-center gap-1 rounded-md border px-1.5 py-1',
        'focus-within:ring-ring focus-within:ring-1'
      )}
    >
      {value.map((tag, index) => (
        <span
          key={`${tag}-${index}`}
          className="bg-muted text-foreground inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs"
        >
          <span className="max-w-32 truncate">{tag}</span>
          <button
            type="button"
            onClick={() => removeAt(index)}
            className="text-foreground-passive hover:text-foreground"
            aria-label={`Remove ${tag}`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        placeholder={value.length === 0 ? placeholder : ''}
        className="placeholder:text-foreground-passive min-w-24 flex-1 bg-transparent px-1 text-xs outline-none"
      />
    </div>
  );
}
