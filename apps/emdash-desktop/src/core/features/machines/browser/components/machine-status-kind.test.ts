import { describe, expect, it } from 'vitest';
import { deriveMachineStatusKind } from './machine-status-kind';

describe('deriveMachineStatusKind', () => {
  it('is idle while SSH is disconnected', () => {
    expect(
      deriveMachineStatusKind({
        connectionState: 'disconnected',
        workspaceServerStatus: undefined,
        workspaceServerLoading: false,
      })
    ).toBe('idle');
  });

  it.each(['connecting', 'reconnecting'] as const)(
    'is initializing while SSH is %s',
    (connectionState) => {
      expect(
        deriveMachineStatusKind({
          connectionState,
          workspaceServerStatus: undefined,
          workspaceServerLoading: false,
        })
      ).toBe('initializing');
    }
  );

  it('is successful when SSH and the workspace server are connected', () => {
    expect(
      deriveMachineStatusKind({
        connectionState: 'connected',
        workspaceServerStatus: 'healthy',
        workspaceServerLoading: false,
      })
    ).toBe('successful');
  });

  it.each(['booting', 'shutting-down'] as const)(
    'is initializing while the workspace server is %s',
    (workspaceServerStatus) => {
      expect(
        deriveMachineStatusKind({
          connectionState: 'connected',
          workspaceServerStatus,
          workspaceServerLoading: false,
        })
      ).toBe('initializing');
    }
  );

  it('is initializing while the workspace server state is loading', () => {
    expect(
      deriveMachineStatusKind({
        connectionState: 'connected',
        workspaceServerStatus: undefined,
        workspaceServerLoading: true,
      })
    ).toBe('initializing');
  });

  it.each(['error', 'failed', 'not-installed', 'stopped'] as const)(
    'is an error when a required connection is unavailable (%s)',
    (status) => {
      const connectionState = status === 'error' ? status : 'connected';
      const workspaceServerStatus = status === 'error' ? undefined : status;

      expect(
        deriveMachineStatusKind({
          connectionState,
          workspaceServerStatus,
          workspaceServerLoading: false,
        })
      ).toBe('error');
    }
  );

  it('is an error when a connected machine has no workspace server state', () => {
    expect(
      deriveMachineStatusKind({
        connectionState: 'connected',
        workspaceServerStatus: undefined,
        workspaceServerLoading: false,
      })
    ).toBe('error');
  });
});
