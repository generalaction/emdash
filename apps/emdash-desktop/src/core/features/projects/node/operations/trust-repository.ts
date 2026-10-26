import type { HostRef } from '@emdash/core/primitives/host/api';
import type { TrustRepositoryResult } from '@emdash/core/runtimes/git/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { err, type Result } from '@emdash/shared';
import { WireError } from '@emdash/wire/rpc';
import type { TrustProjectRepositoryError } from '@core/features/projects/api';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';

/**
 * Trusts a repository Git refused for its ownership on the host that runs Git for it, so the
 * entry lands in that host user's global Git config.
 */
export async function trustProjectRepository(
  dependencies: { runtimes: Pick<RuntimeBroker, 'client'> },
  host: HostRef,
  path: string,
  safeDirectory: string
): Promise<Result<TrustRepositoryResult, TrustProjectRepositoryError>> {
  const runtime = await dependencies.runtimes.client(host);
  if (!runtime.success) return err(runtime.error);

  let hostPath: ReturnType<typeof hostPathFromNative>;
  try {
    hostPath = hostPathFromNative(path);
  } catch (error) {
    return err({
      type: 'invalid-path',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    return await runtime.data.git.trustRepository({ path: hostPath, safeDirectory });
  } catch (error) {
    // Workspace servers before protocol 12.1 do not serve the procedure.
    if (error instanceof WireError && error.code === 'UNKNOWN_PROCEDURE') {
      return err({
        type: 'unsupported',
        message:
          'The Emdash workspace server on this machine is too old to trust repositories. Update it, or run the command on that machine.',
      });
    }
    throw error;
  }
}
