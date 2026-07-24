import { LOCAL_HOST_REF } from '@primitives/host/api';
import { hostFileRef, parseAbsolute, type HostFileRef } from '@primitives/path/api';
import { describe, expect, it } from 'vitest';
import { createWorkspaceMachine } from './machine';

describe('WorkspaceMachine prepared state', () => {
  it('tracks prepare completion and clears it on last consumer deactivate', () => {
    const workspace = hostFileRefFromNative('/repo');
    const machine = createWorkspaceMachine(workspace, { kind: 'directory' });

    machine.apply({ type: 'PrepareCompleted' });
    expect(machine.current().prepared).toBe(true);

    machine.apply({ type: 'ConsumerActivated', consumer: { id: 'task-1', activatedAt: 1 } });
    machine.apply({ type: 'ConsumerActivated', consumer: { id: 'task-2', activatedAt: 2 } });
    machine.apply({ type: 'ConsumerDeactivated', consumerId: 'task-1' });
    expect(machine.current().prepared).toBe(true);

    machine.apply({ type: 'ConsumerDeactivated', consumerId: 'task-2' });
    expect(machine.current().prepared).toBe(false);
  });

  it('clears prepared when teardown starts', () => {
    const workspace = hostFileRefFromNative('/repo');
    const machine = createWorkspaceMachine(workspace, { kind: 'directory' });

    machine.apply({ type: 'PrepareCompleted' });
    const started = machine.dispatch(
      { type: 'BeginOperation', kind: 'teardown', operationId: 'teardown-1', startedAt: 1 },
      undefined
    );

    expect(started.success).toBe(true);
    expect(machine.current().prepared).toBe(false);
  });
});

function hostFileRefFromNative(nativePath: string): HostFileRef {
  const parsed = parseAbsolute(nativePath, {
    profile: {
      style: process.platform === 'win32' ? 'win32' : 'posix',
      unicodeNormalization: 'preserve',
    },
  });
  if (!parsed.success) throw new Error(parsed.error.message);
  return hostFileRef(LOCAL_HOST_REF, parsed.data);
}
