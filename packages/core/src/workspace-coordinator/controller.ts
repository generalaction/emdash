import { createController } from '@emdash/wire';
import { workspaceCoordinatorContract } from './contract';
import type { WorkspaceCoordinator } from './coordinator';
import type { CoordinatorError } from './schema';

export function createWorkspaceCoordinatorController(coordinator: WorkspaceCoordinator) {
  return createController(workspaceCoordinatorContract, {
    activate: {
      run: (input, ctx) => coordinator.activate(input, ctx),
      toError: toCoordinatorError,
    },
    deactivate: {
      run: (input, ctx) => coordinator.deactivate(input, ctx),
      toError: toCoordinatorError,
    },
    teardown: {
      run: (input, ctx) => coordinator.teardown(input, ctx),
      toError: toCoordinatorError,
    },
  });
}

function toCoordinatorError(error: unknown): CoordinatorError {
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { type?: unknown }).type === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return error as CoordinatorError;
  }

  return {
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  };
}
