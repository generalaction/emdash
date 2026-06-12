import type { Result } from '../../lib/result';
import type { InstallMethod } from '../capability';
import type { DependencyId, HostDependencySelection, InstallCommandError } from './types';

// ---------------------------------------------------------------------------
// Host dependency selection persistence
// ---------------------------------------------------------------------------

export interface IHostDependencyStore {
  getSelection(hostId: string, depId: DependencyId): Promise<HostDependencySelection | null>;
  setSelection(
    hostId: string,
    depId: DependencyId,
    selection: HostDependencySelection
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Install / update command execution
// ---------------------------------------------------------------------------

/** Runs an install or update command string (e.g. "brew install claude"). */
export type InstallCommandRunner = (command: string) => Promise<Result<void, InstallCommandError>>;

/** Unused method arg type alias kept for forward-compatibility. */
export type { InstallMethod };
