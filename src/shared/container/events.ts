export type RunnerMode = 'container' | 'host';

export type RunnerEventType = 'lifecycle' | 'ports' | 'log' | 'error' | 'result';

export type RunnerLifecycleStatus =
  | 'idle'
  | 'building'
  | 'starting'
  | 'ready'
  | 'stopping'
  | 'stopped'
  | 'failed';

export type RunnerLogStream = 'stdout' | 'stderr';

export type RunnerErrorCode =
  | 'DOCKER_NOT_AVAILABLE'
  | 'PORT_ALLOC_FAILED'
  | 'ENVFILE_NOT_FOUND'
  | 'INVALID_CONFIG'
  | 'IMAGE_PULL_FAILED'
  | 'BUILD_FAILED'
  | 'INSTALL_FAILED'
  | 'START_CMD_EXITED'
  | 'HEALTHCHECK_TIMEOUT'
  | 'CONTAINER_DIED'
  | 'VOLUME_ERROR'
  | 'UNKNOWN';

export type RunnerResultStatus = 'stopped' | 'failed';

interface RunnerEventEnvelope<T extends RunnerEventType> {
  ts: number;
  workspaceId: string;
  mode: RunnerMode;
  type: T;
  runId: string;
}

export interface RunnerLifecycleEvent extends RunnerEventEnvelope<'lifecycle'> {
  status: RunnerLifecycleStatus;
  containerId?: string;
  exitCode?: number | null;
}

export interface RunnerPortMapping {
  service: string;
  protocol: 'tcp';
  container: number;
  host: number;
  url?: string;
}

export interface RunnerPortsEvent extends RunnerEventEnvelope<'ports'> {
  previewService: string;
  ports: RunnerPortMapping[];
}

export interface RunnerLogEvent extends RunnerEventEnvelope<'log'> {
  stream: RunnerLogStream;
  message: string;
}

export interface RunnerErrorEvent extends RunnerEventEnvelope<'error'> {
  code: RunnerErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface RunnerResultEvent extends RunnerEventEnvelope<'result'> {
  status: RunnerResultStatus;
  exitCode?: number | null;
  durationMs?: number;
}

export type RunnerEvent =
  | RunnerLifecycleEvent
  | RunnerPortsEvent
  | RunnerLogEvent
  | RunnerErrorEvent
  | RunnerResultEvent;

export function isRunnerEvent(value: unknown): value is RunnerEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<RunnerEvent>;
  if (
    typeof candidate.ts !== 'number' ||
    typeof candidate.workspaceId !== 'string' ||
    typeof candidate.mode !== 'string' ||
    typeof candidate.type !== 'string' ||
    typeof candidate.runId !== 'string'
  ) {
    return false;
  }
  switch (candidate.type) {
    case 'lifecycle':
      return (
        typeof (candidate as RunnerLifecycleEvent).status === 'string' &&
        isLifecycleStatus((candidate as RunnerLifecycleEvent).status)
      );
    case 'ports':
      return Array.isArray((candidate as RunnerPortsEvent).ports);
    case 'log':
      return typeof (candidate as RunnerLogEvent).message === 'string';
    case 'error':
      return typeof (candidate as RunnerErrorEvent).code === 'string';
    case 'result':
      return typeof (candidate as RunnerResultEvent).status === 'string';
    default:
      return false;
  }
}

function isLifecycleStatus(value: unknown): value is RunnerLifecycleStatus {
  return (
    value === 'idle' ||
    value === 'building' ||
    value === 'starting' ||
    value === 'ready' ||
    value === 'stopping' ||
    value === 'stopped' ||
    value === 'failed'
  );
}
