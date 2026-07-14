import { describe, expect, it, vi } from 'vitest';
import { provisionWorkspaceErrorToWorkspaceError } from './workspaces-wire';

vi.mock('@main/core/workspaces/workspace-bootstrap-service', () => ({
  runCloneRepositoryProvision: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {},
}));

vi.mock('@main/db/schema', () => ({
  tasks: {},
  workspaces: {},
}));

describe('provisionWorkspaceErrorToWorkspaceError', () => {
  it('maps missing workspace errors to workspace runtime errors', () => {
    expect(provisionWorkspaceErrorToWorkspaceError({ type: 'missing-workspace' })).toEqual({
      type: 'missing-workspace',
      message: 'Workspace row is missing',
    });
  });

  it('preserves setup failure step context', () => {
    expect(
      provisionWorkspaceErrorToWorkspaceError({
        type: 'setup-failed',
        stepKind: 'git-clone',
        stepErrorType: 'clone-destination-exists',
        message: 'Destination already exists',
      })
    ).toEqual({
      type: 'setup-failed',
      stageId: 'git-clone',
      message: 'Destination already exists',
      resolutions: ['clone-destination-exists'],
    });
  });
});
