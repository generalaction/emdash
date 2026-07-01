/** Transitional named import, remove when workspace server runs  */
import type { IFilesRuntime as CoreFilesRuntime } from '@emdash/core/files';
import type { IGitRuntime } from '@emdash/core/git';
import type { IDisposable, Lease, Unsubscribe } from '@emdash/shared';

export type MachineRef = { kind: 'local' } | { kind: 'ssh'; connectionId: string };

export type RuntimeHealth =
  | { status: 'ok' }
  | { status: 'degraded'; reason: string }
  | { status: 'disconnected' };

export interface HealthSource {
  current(): RuntimeHealth;
  subscribe(cb: (health: RuntimeHealth) => void): Unsubscribe;
}

/**
 * Transitional: per-runtime path algebra bound to the machine that owns the files.
 * Removed when the workspace server moves remote path math into core.
 */
export type RuntimePath = {
  join(...parts: string[]): string;
  dirname(path: string): string;
  basename(path: string): string;
  isAbsolute(path: string): boolean;
  relative(from: string, to: string): string;
  contains(parent: string, child: string): boolean;
};

/** Transitional named import, remove when workspace server runs  */
export type IFilesRuntime = CoreFilesRuntime & { readonly path: RuntimePath };

export interface MachineRuntime extends IDisposable {
  readonly machine: MachineRef;
  readonly files: IFilesRuntime;
  readonly git: IGitRuntime;
  readonly health: HealthSource;
}

export interface RuntimeManager {
  acquire(machine: MachineRef): Promise<Lease<MachineRuntime>>;
}

export function machineKey(machine: MachineRef): string {
  return machine.kind === 'local' ? 'local' : `ssh:${machine.connectionId}`;
}
