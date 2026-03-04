export const LIFECYCLE_EVENT_CHANNEL = 'lifecycle:event' as const;

export const LIFECYCLE_PHASES = ['setup', 'run', 'teardown'] as const;
export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number];

export const LIFECYCLE_EVENT_STATUSES = ['starting', 'line', 'done', 'error', 'exit'] as const;
export type LifecycleEventStatus = (typeof LIFECYCLE_EVENT_STATUSES)[number];

export const LIFECYCLE_PHASE_STATES = ['idle', 'running', 'succeeded', 'failed'] as const;
export type LifecyclePhaseStateStatus = (typeof LIFECYCLE_PHASE_STATES)[number];

export interface LifecycleScriptConfig {
  setup?: string;
  run?: string;
  teardown?: string;
}

export interface LifecyclePhaseState {
  status: LifecyclePhaseStateStatus;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  error?: string | null;
}

export interface LifecycleRunState extends LifecyclePhaseState {
  pid?: number | null;
}

export interface TaskLifecycleState {
  taskId: string;
  setup: LifecyclePhaseState;
  run: LifecycleRunState;
  teardown: LifecyclePhaseState;
}

export interface LifecycleEvent {
  taskId: string;
  phase: LifecyclePhase;
  status: LifecycleEventStatus;
  line?: string;
  error?: string;
  exitCode?: number | null;
  timestamp: string;
}

export const MAX_LIFECYCLE_LOG_LINES = 300;

export type LifecycleLogs = Record<LifecyclePhase, string[]>;

export function formatLifecycleLogLine(
  phase: LifecyclePhase,
  status: string,
  extras?: { line?: string; exitCode?: number | null; error?: string }
): string | null {
  if (status === 'starting') return `$ ${phase} started\n`;
  if (status === 'line' && typeof extras?.line === 'string') return extras.line;
  if (status === 'done') return `$ ${phase} finished (exit ${extras?.exitCode ?? 0})\n`;
  if (status === 'error') {
    const detail = typeof extras?.error === 'string' ? `: ${extras.error}` : '';
    return `$ ${phase} failed (exit ${extras?.exitCode ?? 'unknown'})${detail}\n`;
  }
  if (phase === 'run' && status === 'exit') {
    const code = extras?.exitCode === null ? 'signal' : extras?.exitCode;
    return `$ run exited (${code})\n`;
  }
  return null;
}
