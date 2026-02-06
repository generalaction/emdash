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

