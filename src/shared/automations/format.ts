import { dayTokenIndex, isWeekdaysToken, isWeekendToken } from '@shared/automations/schedule';
import type {
  AutomationRun,
  AutomationRunStatus,
  AutomationRunTriggerKind,
  CronTrigger,
} from '@shared/automations/types';

export const QUEUE_DEADLINE_EXCEEDED_ERROR = 'queue_deadline_exceeded' as const;

const dayNames = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
] as const;

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function formatTimeOfDay(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  if (minute === 0) return `${h12} ${period}`;
  return `${h12}:${minute.toString().padStart(2, '0')} ${period}`;
}

type DayOfWeekDesc =
  | { kind: 'all' }
  | { kind: 'weekdays' }
  | { kind: 'weekends' }
  | { kind: 'list'; days: number[] };

function parseDayOfWeek(dow: string): DayOfWeekDesc | null {
  if (dow === '*') return { kind: 'all' };
  if (isWeekdaysToken(dow)) return { kind: 'weekdays' };
  if (isWeekendToken(dow)) return { kind: 'weekends' };

  const tokens = dow.split(',').map((token) => token.trim());
  const days: number[] = [];
  for (const token of tokens) {
    if (token.length === 0) return null;
    const upper = token.toUpperCase();
    if (/^\d$/.test(upper)) {
      const n = parseInt(upper, 10);
      if (n < 0 || n > 6) return null;
      days.push(n);
    } else if (upper in dayTokenIndex) {
      days.push(dayTokenIndex[upper]);
    } else {
      return null;
    }
  }
  if (days.length === 0) return null;
  return { kind: 'list', days };
}

function joinLabels(labels: string[]): string {
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  const last = labels[labels.length - 1];
  return `${labels.slice(0, -1).join(', ')} and ${last}`;
}

function dayDescription(desc: DayOfWeekDesc): string | null {
  switch (desc.kind) {
    case 'all':
      return null;
    case 'weekdays':
      return 'Mon–Fri';
    case 'weekends':
      return 'Sat–Sun';
    case 'list':
      return joinLabels(desc.days.map((index) => dayNames[index]));
  }
}

export function formatCronLabel(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;
  const minNum = /^\d+$/.test(min) ? parseInt(min, 10) : null;
  const hourNum = /^\d+$/.test(hour) ? parseInt(hour, 10) : null;

  if (mon === '*' && dow === '*' && /^\d+$/.test(dom) && minNum !== null && hourNum !== null) {
    const day = parseInt(dom, 10);
    return `Monthly · ${ordinal(day)} · ${formatTimeOfDay(hourNum, minNum)}`;
  }

  if (dom !== '*' || mon !== '*') return expr;

  const dowDesc = parseDayOfWeek(dow);
  if (!dowDesc) return expr;

  if (hour === '*') {
    if (min === '*') {
      if (dowDesc.kind === 'all') return 'Every minute';
      const days = dayDescription(dowDesc);
      return days ? `Every minute · ${days}` : expr;
    }
    const everyN = min.match(/^\*\/(\d+)$/);
    if (everyN) {
      if (dowDesc.kind === 'all') return `Every ${everyN[1]} min`;
      const days = dayDescription(dowDesc);
      return days ? `Every ${everyN[1]} min · ${days}` : expr;
    }
    if (minNum !== null) {
      const base = minNum === 0 ? 'Hourly' : `Hourly :${minNum.toString().padStart(2, '0')}`;
      if (dowDesc.kind === 'all') return base;
      const days = dayDescription(dowDesc);
      return days ? `${base} · ${days}` : expr;
    }
    return expr;
  }

  if (minNum !== null && hourNum !== null) {
    const time = formatTimeOfDay(hourNum, minNum);
    if (dowDesc.kind === 'all') return `Daily · ${time}`;
    const days = dayDescription(dowDesc);
    return days ? `${days} · ${time}` : expr;
  }

  return expr;
}

export function formatTriggerLabel(trigger: CronTrigger): string {
  return formatCronLabel(trigger.expr);
}

export function formatRunStatusLabel(status: AutomationRunStatus): string | null {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'failed':
      return 'Failed';
    case 'skipped':
      return 'Skipped';
    case 'running':
      return 'Running';
    case 'success':
      return null;
  }
}

export function isQueueDeadlineExceededRun(run: Pick<AutomationRun, 'status' | 'error'>): boolean {
  return run.status === 'skipped' && run.error === QUEUE_DEADLINE_EXCEEDED_ERROR;
}

const ERROR_MESSAGES = {
  project_not_found: 'Project could not be found or opened',
  task_create_prompt_empty: 'The task prompt is empty — add one before running',
  no_actions_configured: 'This automation has no actions yet',
  interrupted_by_restart: 'The run was interrupted because the app restarted',
  previous_still_running: 'Skipped because the previous run is still in progress',
  [QUEUE_DEADLINE_EXCEEDED_ERROR]: 'Skipped because it waited in the queue for too long',
  no_project_attached: 'Skipped because the automation is not attached to a project',
  automation_disabled: 'Skipped because the automation schedule was paused',
  name_required: 'Give the automation a name',
  name_too_long: 'The name is too long',
  actions_required: 'Add at least one action before saving',
  automation_not_found: 'This automation no longer exists',
  automation_is_draft: 'Finish setting up the automation before running it',
  automation_run_in_flight: 'Wait for the run to finish before deleting it',
  automation_run_already_queued: 'This automation already has a queued or running run',
  automation_run_not_found: 'This automation run no longer exists',
  interrupted_by_restart_task_preserved:
    'The run was interrupted because the app restarted, but its agent was preserved',
  interrupted_by_restart_task_missing:
    'The run was interrupted because the app restarted and its agent could not be found',
  run_update_failed: 'The automation run could not be updated',
} as const;

const PREFIXED_ERROR_MESSAGES: ReadonlyArray<{
  prefix: string;
  format: (value: string) => string;
}> = [
  {
    prefix: 'initial_commit_required:',
    format: (value) => `Branch "${value}" has no commits yet`,
  },
  {
    prefix: 'branch_create_failed:',
    format: (value) => `Could not create branch "${value}"`,
  },
  {
    prefix: 'pr_fetch_failed:',
    format: (value) => `Could not fetch pull requests from "${value}"`,
  },
  {
    prefix: 'branch_not_found:',
    format: (value) => `Branch "${value}" was not found`,
  },
  {
    prefix: 'worktree_setup_failed:',
    format: (value) => `Could not set up the worktree for "${value}"`,
  },
] as const;

function knownErrorMessage(raw: string): string | undefined {
  return ERROR_MESSAGES[raw as keyof typeof ERROR_MESSAGES];
}

function normalizeActionError(raw: string): string {
  return raw.replace(/^action_\d+_[^:]+:/, '');
}

export function formatRunError(raw: string): string {
  const normalized = normalizeActionError(raw);
  const exact = knownErrorMessage(normalized);
  if (exact) return exact;

  for (const { prefix, format } of PREFIXED_ERROR_MESSAGES) {
    if (normalized.startsWith(prefix)) return format(normalized.slice(prefix.length));
  }

  if (normalized.startsWith('provisioning timed out'))
    return 'Setting up the task took too long and timed out';
  if (normalized.startsWith('action_invalid:'))
    return 'One of the actions is not configured correctly';

  return raw;
}

export function formatAutomationError(error: unknown): string {
  if (error instanceof Error) return formatRunError(error.message);
  if (typeof error === 'string') return formatRunError(error);
  return 'Something went wrong';
}

export function formatRunTriggerKindLabel(kind: AutomationRunTriggerKind): string {
  switch (kind) {
    case 'cron':
      return 'Schedule';
    case 'manual':
      return 'Manual';
  }
}
