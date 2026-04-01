import type { IntegrationId } from '../integrations/types';

export type ScheduleType = 'hourly' | 'daily' | 'weekly' | 'monthly';

export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface AutomationSchedule {
  type: ScheduleType;
  /** Hour of day (0-23) for daily/weekly/monthly */
  hour?: number;
  /** Minute of hour (0-59) */
  minute?: number;
  /** Day of week for weekly */
  dayOfWeek?: DayOfWeek;
  /** Day of month for monthly (1-31) */
  dayOfMonth?: number;
}

export type TriggerType =
  | 'github_pr'
  | 'github_issue'
  | 'linear_issue'
  | 'jira_issue'
  | 'gitlab_issue'
  | 'gitlab_mr'
  | 'forgejo_issue'
  | 'plain_thread'
  | 'sentry_issue';

export interface TriggerConfig {
  /** Filter PRs/issues by branch pattern (glob), e.g. "feature/*" */
  branchFilter?: string;
  /** Only trigger for PRs/issues with these labels */
  labelFilter?: string[];
  /** Only trigger for PRs/issues assigned to this user */
  assigneeFilter?: string;
}

/** 'schedule' = cron-like, 'trigger' = event-driven (polling) */
export type AutomationMode = 'schedule' | 'trigger';

export type AutomationStatus = 'active' | 'paused' | 'error';

export interface Automation {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  /** The prompt/instruction to send to the agent */
  prompt: string;
  /** The coding agent provider id to use */
  agentId: string;
  /** Whether this automation is schedule-based or trigger-based */
  mode: AutomationMode;
  schedule: AutomationSchedule;
  /** Event trigger type (only used when mode === 'trigger') */
  triggerType: TriggerType | null;
  /** Event trigger filter config (only used when mode === 'trigger') */
  triggerConfig: TriggerConfig | null;
  /** Whether to create a worktree for each run */
  useWorktree: boolean;
  status: AutomationStatus;
  /** ISO timestamp of last run */
  lastRunAt: string | null;
  /** ISO timestamp of next scheduled run (null for trigger-based) */
  nextRunAt: string | null;
  /** Number of times this automation has run */
  runCount: number;
  /** Last run result */
  lastRunResult: 'success' | 'failure' | null;
  /** Error message if last run failed */
  lastRunError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunLog {
  id: string;
  automationId: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'failure';
  error: string | null;
  /** The task ID that was created for this run */
  taskId: string | null;
}

export interface CreateAutomationInput {
  name: string;
  projectId: string;
  /** Resolved project name — set by the backend from projectId */
  projectName?: string;
  prompt: string;
  agentId: string;
  /** 'schedule' (default) or 'trigger' */
  mode?: AutomationMode;
  schedule: AutomationSchedule;
  /** Event trigger type (required when mode === 'trigger') */
  triggerType?: TriggerType;
  /** Event trigger filter config */
  triggerConfig?: TriggerConfig;
  /** Whether to create a worktree for each run (default: true) */
  useWorktree?: boolean;
}

/** Maps each trigger type to the integration it requires. Single source of truth shared by main and renderer. */
export const TRIGGER_INTEGRATION_MAP: Record<TriggerType, IntegrationId> = {
  github_pr: 'github',
  github_issue: 'github',
  linear_issue: 'linear',
  jira_issue: 'jira',
  gitlab_issue: 'gitlab',
  gitlab_mr: 'gitlab',
  forgejo_issue: 'forgejo',
  plain_thread: 'plain',
  sentry_issue: 'sentry',
};

export interface UpdateAutomationInput {
  id: string;
  name?: string;
  projectId?: string;
  /** Resolved project name — set by the backend from projectId */
  projectName?: string;
  prompt?: string;
  agentId?: string;
  mode?: AutomationMode;
  schedule?: AutomationSchedule;
  triggerType?: TriggerType | null;
  triggerConfig?: TriggerConfig | null;
  status?: AutomationStatus;
  useWorktree?: boolean;
}
