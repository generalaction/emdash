/**
 * Re-exports from @emdash/core/acp for local transport consumers.
 * The canonical definitions now live in the core package.
 */
export type { AcpFs, AcpProcessHandle, AcpProcessHost } from '@emdash/core/acp';
export type { MachineRef } from '@main/core/runtime/types';

// ---------------------------------------------------------------------------
// AcpProcessHostManager: keyed by MachineRef
// ---------------------------------------------------------------------------

import type { AcpProcessHost } from '@emdash/core/acp';
import type { MachineRef } from '@main/core/runtime/types';

export interface AcpProcessHostManager {
  /**
   * Returns the AcpProcessHost for the given machine (local or remote SSH).
   * Calling get() for an SSH machine will establish the SSH connection if
   * not already connected.
   */
  get(machine: MachineRef): Promise<AcpProcessHost>;
}
