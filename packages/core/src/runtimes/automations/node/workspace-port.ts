import { err, ok } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import { createLiveJobReplica } from '@emdash/wire';
import type { ContractClient } from '@emdash/wire/api';
import {
  workspaceProvisioningContract,
  type WorkspaceProvisioningContract,
} from '@services/workspace-provisioning/api';
import type { AutomationPortError, AutomationWorkspacePort } from './ports';

const CANCELLED_ERROR = {
  code: 'cancelled',
  message: 'Workspace provisioning was cancelled',
} satisfies AutomationPortError;

export function createWorkspacePortFromDependency(
  client: ContractClient<WorkspaceProvisioningContract>,
  scope: Scope
): AutomationWorkspacePort {
  const jobs = createLiveJobReplica(
    workspaceProvisioningContract.provisionFromIntent,
    client.provisionFromIntent
  );
  scope.add(() => jobs.dispose());

  return {
    async provision(input) {
      if (input.signal.aborted) return err(CANCELLED_ERROR);

      try {
        const lease = await jobs.start({
          workspace: input.workspace,
          generatedName: input.generatedName,
        });
        try {
          const job = await lease.ready();
          const cancel = () => void job.cancel();
          input.signal.addEventListener('abort', cancel, { once: true });
          if (input.signal.aborted) cancel();

          try {
            return ok(await job.result);
          } catch (error) {
            const state = job.getState();
            if (state?.status === 'cancelled') return err(CANCELLED_ERROR);
            if (state?.status === 'failed') {
              return err(
                state.error
                  ? { code: state.error.type, message: state.error.message }
                  : {
                      code: 'workspace_provisioning_failed',
                      message: state.cause?.message ?? 'Workspace provisioning failed',
                    }
              );
            }
            throw error;
          } finally {
            input.signal.removeEventListener('abort', cancel);
          }
        } finally {
          await lease.release();
        }
      } catch (error) {
        return err({
          code: 'workspace_provisioning_failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
