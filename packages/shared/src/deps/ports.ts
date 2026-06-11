import type { InstallMethod } from '@emdash/cli-agent-plugins';
import type { Result } from '../lib/result';
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

// ---------------------------------------------------------------------------
// Minimal logger interface
// ---------------------------------------------------------------------------

export interface DepsLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

/** No-op logger for testing or contexts without a log sink. */
export const noopLogger: DepsLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** Console-backed logger used as the shared default. */
export const consoleLogger: DepsLogger = {
  info: (message, ...args) => console.info(message, ...args),
  warn: (message, ...args) => console.warn(message, ...args),
  error: (message, ...args) => console.error(message, ...args),
  debug: (message, ...args) => console.debug(message, ...args),
};

/** Unused method arg type alias kept for forward-compatibility. */
export type { InstallMethod };
