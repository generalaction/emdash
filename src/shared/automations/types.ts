export type ScheduleType = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';

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
  /** Cron expression for custom schedules */
  cronExpression?: string;
}

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
  schedule: AutomationSchedule;
  status: AutomationStatus;
  /** ISO timestamp of last run */
  lastRunAt: string | null;
  /** ISO timestamp of next scheduled run */
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
  prompt: string;
  agentId: string;
  schedule: AutomationSchedule;
}

export interface UpdateAutomationInput {
  id: string;
  name?: string;
  prompt?: string;
  agentId?: string;
  schedule?: AutomationSchedule;
  status?: AutomationStatus;
}
