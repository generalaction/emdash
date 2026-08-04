import type { HostRef } from '@emdash/core/primitives/host/api';
import { submitAndFollowWorkspaceOperation } from '@emdash/core/runtimes/workspace/api';
import {
  runtimeResolveErrorAsError,
  type RuntimeBroker,
} from '@emdash/core/services/runtime-broker/api';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import type { WorkspaceRuntimeClient } from '@core/services/runtime-broker/api/clients';

export type LifecycleCleanupDependencies = {
  runtimes: Pick<RuntimeBroker, 'client'>;
};

/**
 * Consumer release for the host outbox path: stops workspace-runtime consumers
 * (running teardown scripts) before the host removes a worktree.
 */
export async function deactivateWorkspaceConsumers(
  dependencies: Pick<LifecycleCleanupDependencies, 'runtimes'>,
  input: {
    hostRef: string;
    workspacePath: string;
    consumers: 'all' | readonly string[];
    operationId: string;
    initiatedBy?: string;
  },
  options: { signal?: AbortSignal; onWaitingChange?: (waiting: boolean) => void } = {}
): Promise<void> {
  const workspace = hostFileRefFromNativePath(
    input.workspacePath,
    input.hostRef === 'local' ? undefined : input.hostRef
  );
  const client = await resolveWorkspaceRuntimeClient(dependencies, workspace.host);
  const consumerIds =
    input.consumers === 'all'
      ? await client.workspace
          .state(workspace, 'state')
          .snapshot()
          .then((snapshot) => snapshot.data.consumers.map((consumer) => consumer.id))
          .catch(() => [])
      : [...input.consumers];
  const resolvedConsumerIds = consumerIds.length > 0 ? consumerIds : [input.operationId];

  for (const consumerId of resolvedConsumerIds) {
    const result = await submitAndFollowWorkspaceOperation(
      client,
      {
        requestId: `${input.operationId}:deactivate:${consumerId}`,
        kind: 'deactivate',
        workspace,
        initiatedBy: input.initiatedBy ? { clientId: input.initiatedBy } : undefined,
        params: {
          kind: 'deactivate',
          input: {
            workspace,
            consumerId,
            strategy: 'stop',
          },
        },
      },
      { signal: options.signal, onWaitingChange: options.onWaitingChange }
    );
    if (!result.success && !isMissingError(result.error)) {
      throw new Error(result.error.message);
    }
  }
}

async function resolveWorkspaceRuntimeClient(
  dependencies: Pick<LifecycleCleanupDependencies, 'runtimes'>,
  host: HostRef
): Promise<WorkspaceRuntimeClient> {
  const runtime = await dependencies.runtimes.client(host);
  if (!runtime.success) throw runtimeResolveErrorAsError(runtime.error);
  return runtime.data.workspace;
}

function isMissingError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('type' in error)) return false;
  const type = String(error.type);
  return type === 'not-found' || type === 'workspace-not-found' || type === 'missing-workspace';
}
