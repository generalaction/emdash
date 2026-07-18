import type { BootstrapError, PlanRejection } from './schemas';

export function planRejectionToBootstrapError(rejection: PlanRejection): BootstrapError {
  if (rejection.type === 'unsupported-step') {
    return {
      type: rejection.type,
      stepKind: rejection.kind,
      message: rejection.message,
    };
  }
  return {
    type: rejection.type,
    stepId: rejection.stepId,
    stepKind: rejection.stepKind,
    message: rejection.message,
  };
}

export function toBootstrapError(error: unknown): BootstrapError {
  if (isBootstrapError(error)) return error;
  return {
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  };
}

export function isBootstrapError(error: unknown): error is BootstrapError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { type?: unknown }).type === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}
