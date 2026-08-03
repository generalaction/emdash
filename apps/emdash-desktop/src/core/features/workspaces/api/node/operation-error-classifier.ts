import type { OperationErrorClassifier } from '@core/services/operations/node';

export const classifyWorkspaceOperationError: OperationErrorClassifier = (error) => {
  const code = errorCode(error);
  if (code === 'workspace-busy') {
    return {
      type: 'needs-confirmation',
      reason: 'workspace-busy',
      message: workspaceBusyMessage(error),
    };
  }
  if (code === 'workspace-in-use') {
    return {
      type: 'failed',
      code,
      message: errorMessage(error),
      retryable: false,
    };
  }
  return undefined;
};

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function workspaceBusyMessage(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const holders =
    typeof error === 'object' &&
    error !== null &&
    'holders' in error &&
    Array.isArray(error.holders)
      ? error.holders.filter((holder): holder is string => typeof holder === 'string')
      : [];
  if (holders.length === 0) return error.message;
  return `${error.message} Active holders: ${holders.join(', ')}`;
}
