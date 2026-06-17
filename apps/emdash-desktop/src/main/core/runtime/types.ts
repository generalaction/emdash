import type { IGitRuntime } from '@emdash/core/git';
import type { IDisposable, Lease, Unsubscribe } from '@emdash/core/lib';

export type MachineRef = { kind: 'local' } | { kind: 'ssh'; connectionId: string };

export type RuntimeHealth =
  | { status: 'ok' }
  | { status: 'degraded'; reason: string }
  | { status: 'disconnected' };

export interface HealthSource {
  current(): RuntimeHealth;
  subscribe(cb: (health: RuntimeHealth) => void): Unsubscribe;
}

export interface MachineRuntime extends IDisposable {
  readonly machine: MachineRef;
  readonly git: IGitRuntime;
  readonly health: HealthSource;
}

export interface RuntimeManager {
  acquire(machine: MachineRef): Promise<Lease<MachineRuntime>>;
}

export function machineKey(machine: MachineRef): string {
  return machine.kind === 'local' ? 'local' : `ssh:${machine.connectionId}`;
}
