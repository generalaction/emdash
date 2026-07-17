import { err, ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { createTestWire } from '@emdash/wire/testing';
import { LOCAL_HOST_REF } from '@primitives/host/api';
import { hostFileRef, parseAbsolute } from '@primitives/path/api';
import {
  workspaceProvisioningContract,
  type WorkspaceProvisioningInput,
} from '@services/workspace-provisioning/api';
import { describe, expect, it } from 'vitest';
import { createWorkspacePortFromDependency } from './workspace-port';

const repository = absolute('/tmp/repository');
const workspace = absolute('/tmp/worktrees/automation-1');
const input = {
  workspace: {
    kind: 'worktree' as const,
    repository,
    preservePatterns: ['.env*'],
    git: {
      kind: 'create-branch' as const,
      fromBranch: { type: 'local' as const, branch: 'main' },
      pushRemote: null,
    },
  },
  generatedName: 'automation-1',
};

describe('createWorkspacePortFromDependency', () => {
  it('starts intent provisioning and returns its workspace result', async () => {
    let received: WorkspaceProvisioningInput | undefined;
    const wire = createTestWire(workspaceProvisioningContract, {
      provisionFromIntent: {
        run: async (jobInput) => {
          received = jobInput;
          return ok({ workspace, branchName: 'automation-1' });
        },
      },
    });
    const scope = createScope({ label: 'workspace-port-test' });
    const port = createWorkspacePortFromDependency(wire.client, scope);

    try {
      await expect(
        port.provision({ ...input, signal: new AbortController().signal })
      ).resolves.toEqual(ok({ workspace, branchName: 'automation-1' }));
      expect(received).toEqual(input);
    } finally {
      await scope.dispose();
      await wire.dispose();
    }
  });

  it('maps typed job failures to automation port errors', async () => {
    const wire = createTestWire(workspaceProvisioningContract, {
      provisionFromIntent: {
        run: async () => err({ type: 'configuration', message: 'Missing worktree pool' }),
      },
    });
    const scope = createScope({ label: 'workspace-port-test' });
    const port = createWorkspacePortFromDependency(wire.client, scope);

    try {
      await expect(
        port.provision({ ...input, signal: new AbortController().signal })
      ).resolves.toEqual(err({ code: 'configuration', message: 'Missing worktree pool' }));
    } finally {
      await scope.dispose();
      await wire.dispose();
    }
  });

  it('does not start a job for an already-aborted run', async () => {
    let started = false;
    const wire = createTestWire(workspaceProvisioningContract, {
      provisionFromIntent: {
        run: async () => {
          started = true;
          return ok({ workspace, branchName: 'automation-1' });
        },
      },
    });
    const scope = createScope({ label: 'workspace-port-test' });
    const port = createWorkspacePortFromDependency(wire.client, scope);
    const controller = new AbortController();
    controller.abort();

    try {
      await expect(port.provision({ ...input, signal: controller.signal })).resolves.toEqual(
        err({ code: 'cancelled', message: 'Workspace provisioning was cancelled' })
      );
      expect(started).toBe(false);
    } finally {
      await scope.dispose();
      await wire.dispose();
    }
  });
});

function absolute(input: string) {
  const parsed = parseAbsolute(input);
  if (!parsed.success) throw new Error(parsed.error.message);
  return hostFileRef(LOCAL_HOST_REF, parsed.data);
}
