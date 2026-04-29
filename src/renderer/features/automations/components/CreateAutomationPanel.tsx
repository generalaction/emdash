import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUp,
  ChevronDown,
  Clock,
  FolderOpen,
  GitBranch,
  Github,
  Loader2,
  Webhook,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  AGENT_PROVIDER_IDS,
  isValidProviderId,
  type AgentProviderId,
} from '@shared/agent-provider-registry';
import type { ActionSpec, TaskCreateAction } from '@shared/automations/actions';
import { automationCatalogCategories } from '@shared/automations/builtin-catalog';
import type { AutomationEventKind, EventProviderScope } from '@shared/automations/events';
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
import type { Automation, BuiltinAutomationTemplate, TriggerSpec } from '@shared/automations/types';
import {
  asMounted,
  getProjectManagerStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import AgentLogo from '@renderer/lib/components/agent-logo';
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
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { useAutomations } from '../useAutomations';

const DEFAULT_CRON = scheduleToCron(DEFAULT_SCHEDULE);

const GITHUB_EVENTS: readonly AutomationEventKind[] = [
  'pr.opened',
  'pr.merged',
  'pr.closed',
  'pr.review_requested',
  'ci.failed',
  'ci.succeeded',
  'issue.opened',
  'issue.closed',
  'issue.assigned',
  'issue.commented',
] as const;

const GITHUB_EVENT_ITEMS: PillItem<AutomationEventKind>[] = GITHUB_EVENTS.map((kind) => ({
  value: kind,
  label: formatEventLabel(kind),
}));

const DEFAULT_GITHUB_EVENT: AutomationEventKind = 'pr.opened';

type TriggerKindUI = 'cron' | 'github';
type TaskCreateMode = NonNullable<TaskCreateAction['mode']>;

const TRIGGER_KINDS: PillItem<TriggerKindUI>[] = [
  { value: 'cron', label: 'Schedule' },
  { value: 'github', label: 'GitHub' },
];

const TASK_CREATE_MODES: PillItem<TaskCreateMode>[] = [
  { value: 'direct', label: 'Direct' },
  { value: 'worktree', label: 'Worktree' },
];

const PILL_TRIGGER_CLASS =
  'inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs ' +
  'text-muted-foreground hover:bg-muted/40 outline-none data-popup-open:bg-muted/40';

function deriveName(prompt: string): string {
  const firstLine =
    prompt
      .split('\n')
      .find((line) => line.trim().length > 0)
      ?.trim() ?? '';
  if (!firstLine) return 'New automation';
  if (firstLine.length <= 60) return firstLine;
  return `${firstLine.slice(0, 57).trimEnd()}…`;
}

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

function eventProviderFromTrigger(trigger: TriggerSpec | undefined): EventProviderScope | null {
  if (trigger?.kind !== 'event') return null;
  return trigger.provider ?? null;
}

function triggerKindFromSpec(trigger: TriggerSpec | undefined): TriggerKindUI {
  return trigger?.kind === 'event' ? 'github' : 'cron';
}

interface CreateAutomationPanelProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  template?: BuiltinAutomationTemplate;
  automation?: Automation;
  onSaved?: (automation: Automation) => void;
}

export function CreateAutomationPanel({
  open,
  onOpenChange,
  template,
  automation,
  onSaved,
}: CreateAutomationPanelProps) {
  const seedKey = automation?.id ?? template?.id ?? '__new__';
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="create-automation-panel"
          initial={{ height: 0, opacity: 0, y: 12 }}
          animate={{ height: 'auto', opacity: 1, y: 0 }}
          exit={{ height: 0, opacity: 0, y: 6 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          style={{ overflow: 'hidden' }}
        >
          <PanelBody
            key={seedKey}
            template={template}
            automation={automation}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface PanelBodyProps {
  template?: BuiltinAutomationTemplate;
  automation?: Automation;
  onClose: () => void;
  onSaved?: (automation: Automation) => void;
}

function PanelBody({ template, automation, onClose, onSaved }: PanelBodyProps) {
  const seedTrigger = automation?.trigger ?? template?.defaultTrigger;
  const seedEventProvider = eventProviderFromTrigger(seedTrigger);
  const seedTaskAction = extractTaskAction(automation?.actions ?? template?.defaultActions);

  const { value: defaultAgentValue } = useAppSettingsKey('defaultAgent');
  const fallbackProvider: AgentProviderId = isValidProviderId(defaultAgentValue)
    ? defaultAgentValue
    : 'claude';

  const [prompt, setPrompt] = useState(seedTaskAction?.prompt ?? '');
  const [projectId, setProjectId] = useState<string | undefined>(
    automation?.projectId ?? firstMountedProjectId()
  );
  const [provider, setProvider] = useState<AgentProviderId>(
    seedTaskAction?.provider ?? fallbackProvider
  );
  const [taskCreateMode, setTaskCreateMode] = useState<TaskCreateMode>(
    seedTaskAction?.mode ?? 'direct'
  );
  const [triggerKind, setTriggerKind] = useState<TriggerKindUI>(triggerKindFromSpec(seedTrigger));
  const [cronExpr, setCronExpr] = useState<string>(cronExprFromTrigger(seedTrigger));
  const [githubEvent, setGithubEvent] = useState<AutomationEventKind>(
    githubEventFromTrigger(seedTrigger)
  );
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const { create, update } = useAutomations();
  const isEdit = Boolean(automation);
  const isPending = create.isPending || update.isPending;

  const eventLabel = useMemo(() => formatEventLabel(githubEvent), [githubEvent]);
  const canSave = prompt.trim().length > 0 && !!projectId && !isPending;

  async function handleSave() {
    if (!projectId || !canSave) return;
    setError(null);
    const triggerSpec: TriggerSpec =
      triggerKind === 'cron'
        ? { kind: 'cron', expr: cronExpr.trim(), tz: 'UTC' }
        : { kind: 'event', event: githubEvent, provider: seedEventProvider };
    const actions: ActionSpec[] = [
      { kind: 'task.create', prompt: prompt.trim(), provider, mode: taskCreateMode },
    ];
    try {
      const saved = automation
        ? await update.mutateAsync({
            id: automation.id,
            patch: { trigger: triggerSpec, actions, projectId },
          })
        : await create.mutateAsync({
            name: deriveName(prompt),
            description: null,
            category: template?.category ?? automationCatalogCategories[0],
            trigger: triggerSpec,
            actions,
            projectId,
            builtinTemplateId: template?.id ?? null,
          });
      onClose();
      onSaved?.(saved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  }

  return (
    <div className="mb-4">
      <div className="relative z-10 rounded-xl border border-border bg-background-2 p-3 outline-none">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void handleSave();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
          placeholder="Describe what this automation should do…"
          className={cn(
            'block w-full resize-none bg-transparent px-2 pt-2 pb-1 text-sm',
            'placeholder:text-muted-foreground outline-none',
            'min-h-24 field-sizing-content'
          )}
        />

        <div className="flex items-center justify-between gap-2 px-1 pt-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <AgentPill value={provider} onChange={setProvider} />

            {triggerKind === 'cron' ? (
              <SchedulePicker value={cronExpr} onChange={setCronExpr} />
            ) : (
              <ComboboxPill
                items={GITHUB_EVENT_ITEMS}
                value={githubEvent}
                onChange={setGithubEvent}
                triggerIcon={<Webhook className="size-3.5 shrink-0" />}
                triggerLabel={eventLabel}
              />
            )}
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            aria-label={isEdit ? 'Save automation' : 'Create automation'}
            className={cn(
              'inline-flex size-7 items-center justify-center rounded-full',
              'bg-foreground text-background transition-opacity',
              'hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed'
            )}
          >
            {isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ArrowUp className="size-3.5" />
            )}
          </button>
        </div>
      </div>

      <div
        className={cn(
          'relative z-0 -mt-3 mx-2 rounded-b-xl border border-border bg-background-1',
          'px-3 pt-5 pb-2'
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <ProjectSelector
            value={projectId}
            onChange={setProjectId}
            trigger={
              <ComboboxTrigger className={PILL_TRIGGER_CLASS}>
                <FolderOpen className="size-3.5 shrink-0" />
                <ComboboxValue placeholder="Select project" />
                <ChevronDown className="size-3 shrink-0 text-foreground-passive" />
              </ComboboxTrigger>
            }
          />

          <ComboboxPill
            items={TRIGGER_KINDS}
            value={triggerKind}
            onChange={setTriggerKind}
            triggerIcon={
              triggerKind === 'github' ? (
                <Github className="size-3.5 shrink-0" />
              ) : (
                <Zap className="size-3.5 shrink-0" />
              )
            }
          />

          <ComboboxPill
            items={TASK_CREATE_MODES}
            value={taskCreateMode}
            onChange={setTaskCreateMode}
            triggerIcon={<GitBranch className="size-3.5 shrink-0" />}
          />

          {error && <span className="ml-auto truncate text-xs text-destructive">{error}</span>}
        </div>
      </div>
    </div>
  );
}

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
      <PopoverTrigger className={cn(PILL_TRIGGER_CLASS, 'gap-1.5')}>
        <Clock className="size-3.5 shrink-0" />
        <span>{label}</span>
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
}

interface ComboboxPillProps<V extends string> {
  items: PillItem<V>[];
  value: V;
  onChange: (next: V) => void;
  triggerIcon: ReactNode;
  triggerLabel?: string;
  groupKey?: string;
  renderItem?: (item: PillItem<V>) => ReactNode;
}

function ComboboxPill<V extends string>({
  items,
  value,
  onChange,
  triggerIcon,
  triggerLabel,
  groupKey = 'items',
  renderItem,
}: ComboboxPillProps<V>) {
  const [open, setOpen] = useState(false);
  const selected = items.find((item) => item.value === value) ?? null;
  const label = triggerLabel ?? selected?.label ?? '';

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
      <ComboboxTrigger className={PILL_TRIGGER_CLASS}>
        {triggerIcon}
        <span>{label}</span>
        <ChevronDown className="size-3 shrink-0 text-foreground-passive" />
      </ComboboxTrigger>
      <ComboboxContent className="w-auto min-w-(--anchor-width)">
        <ComboboxList className="py-1">
          {(group: { value: string; items: PillItem<V>[] }) => (
            <ComboboxGroup key={group.value} items={group.items}>
              <ComboboxCollection>
                {(item: PillItem<V>) => (
                  <ComboboxItem key={String(item.value)} value={item}>
                    {renderItem ? renderItem(item) : item.label}
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

interface AgentPillProps {
  value: AgentProviderId;
  onChange: (next: AgentProviderId) => void;
}

function AgentPill({ value, onChange }: AgentPillProps) {
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
