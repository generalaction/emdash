import { err, ok } from '@emdash/shared';
import { cell, expose } from '@emdash/wire';
import { createTestWire } from '@emdash/wire/testing';
import { LOCAL_HOST_REF } from '@primitives/host/api';
import { hostFileRef, parseAbsolute } from '@primitives/path/api';
import { workspaceProvisioningContract } from '@services/workspace-provisioning/api';
import { describe, expect, it } from 'vitest';
import { createWorkspacePortFromDependency } from './workspace-provisioning';

const workspace = absolute('/tmp/workspace');
const input = {
  workspace: { kind: 'directory' as const, path: workspace },
  generatedName: 'automation-1',
};

describe('createWorkspacePortFromDependency', () => {
  it('starts intent provisioning and returns its workspace result', async () => {
    const wire = provisioningWire();
    const port = createWorkspacePortFromDependency(wire.client);

    try {
      await expect(
        port.provision({ ...input, signal: new AbortController().signal })
      ).resolves.toEqual(ok({ workspace, branchName: null }));
    } finally {
      await wire.dispose();
    }
  });

  it('maps workspace operation failures to automation port errors', async () => {
    const wire = provisioningWire({
      error: { type: 'configuration', message: 'Missing workspace' },
    });
    const port = createWorkspacePortFromDependency(wire.client);

    try {
      await expect(
        port.provision({ ...input, signal: new AbortController().signal })
      ).resolves.toEqual(err({ code: 'configuration', message: 'Missing workspace' }));
    } finally {
      await wire.dispose();
    }
  });

  it('does not start a job for an already-aborted run', async () => {
    let started = false;
    const wire = provisioningWire({
      onSubmit: () => {
        started = true;
      },
    });
    const port = createWorkspacePortFromDependency(wire.client);
    const controller = new AbortController();
    controller.abort();

    try {
      await expect(port.provision({ ...input, signal: controller.signal })).resolves.toEqual(
        err({ code: 'cancelled', message: 'Workspace provisioning was cancelled' })
      );
      expect(started).toBe(false);
    } finally {
      await wire.dispose();
    }
  });
});

function absolute(input: string) {
  const parsed = parseAbsolute(input);
  if (!parsed.success) throw new Error(parsed.error.message);
  return hostFileRef(LOCAL_HOST_REF, parsed.data);
}

function provisioningWire(
  options: {
    error?: { type: string; message: string };
    onSubmit?: () => void;
  } = {}
) {
  const list = cell({});
  const host = expose(workspaceProvisioningContract.operationLog, { list });
  const wire = createTestWire(workspaceProvisioningContract, {
    operationLog: host,
    submitOperation: async (request) => {
      options.onSubmit?.();
      list.set({
        [request.requestId]: options.error
          ? {
              requestId: request.requestId,
              status: 'failed',
              error: options.error,
            }
          : {
              requestId: request.requestId,
              status: 'succeeded',
              result: { data: { workspace: request.workspace } },
            },
      });
      return ok({ requestId: request.requestId, seq: 1, outcome: 'accepted' as const });
    },
    cancelOperation: async ({ requestId }) => ok({ requestId, status: 'cancelled' }),
  });
  return {
    client: wire.client,
    async dispose() {
      await host.dispose();
      await wire.dispose();
    },
  };
}
