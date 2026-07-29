import { describe, expect, it } from 'vitest';
import { classifyWorkspaceOperationError } from './operation-error-classifier';

describe('classifyWorkspaceOperationError', () => {
  it('maps workspace-busy errors to awaiting confirmation with holders', () => {
    const error = Object.assign(new Error('Workspace is busy'), {
      code: 'workspace-busy',
      holders: ['task-1', 'task-2'],
    });

    expect(classifyWorkspaceOperationError(error)).toEqual({
      type: 'awaiting-confirmation',
      reason: 'workspace-busy',
      message: 'Workspace is busy Active holders: task-1, task-2',
    });
  });

  it('maps workspace-in-use errors to non-retryable failures', () => {
    const error = Object.assign(new Error('Workspace is still referenced'), {
      code: 'workspace-in-use',
    });

    expect(classifyWorkspaceOperationError(error)).toEqual({
      type: 'failed',
      code: 'workspace-in-use',
      message: 'Workspace is still referenced',
      retryable: false,
    });
  });
});
