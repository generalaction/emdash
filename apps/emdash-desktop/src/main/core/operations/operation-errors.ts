import type { OperationStepError } from './operation-plan';

export type WorkspaceInUseError = {
  type: 'workspace-in-use';
  message: string;
};

export function workspaceInUseError(): WorkspaceInUseError {
  return {
    type: 'workspace-in-use',
    message: 'Workspace is still referenced by an active task.',
  };
}

export function operationStepFailed(message: string): OperationStepError {
  return { code: 'step-failed', message };
}

export function workspaceInUseStepError(): OperationStepError {
  const error = workspaceInUseError();
  return { code: error.type, message: error.message };
}
