import { encodeTopic } from '@emdash/wire';
import { LOCAL_HOST_REF } from '@primitives/host/api';
import { hostFileRef, parseAbsolute } from '@primitives/path/api';
import { workspaceContract } from '@runtimes/workspace/api';
import { WorkspaceRuntime } from '@runtimes/workspace/node/workspace-runtime';
import { describe, expect, it } from 'vitest';
import { createWorkspaceController } from './controller';

describe('createWorkspaceController', () => {
  it('reconstructs workspace state topics before reconcile after a daemon restart', async () => {
    const parsed = parseAbsolute('/tmp/emdash-restored-workspace');
    if (!parsed.success) throw new Error(parsed.error.message);
    const workspace = hostFileRef(LOCAL_HOST_REF, parsed.data);
    const runtime = new WorkspaceRuntime();
    const controller = createWorkspaceController(runtime, { validate: 'full' });

    try {
      const source = controller.resolveLive(
        encodeTopic(workspaceContract.workspace.states.state.id, workspace)
      );

      expect(source?.snapshot()).toMatchObject({
        data: {
          workspace,
          topology: { kind: 'missing' },
          operation: { kind: 'idle' },
        },
      });
    } finally {
      await controller.dispose?.();
      runtime.dispose();
    }
  });
});
