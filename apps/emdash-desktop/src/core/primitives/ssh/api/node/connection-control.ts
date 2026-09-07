import type { ConnectionState } from '../ssh';
import type { SshClientProxy } from './ssh-client-proxy';

export type SshFailureKind =
  | 'authentication'
  | 'configuration'
  | 'host-key'
  | 'transport'
  | 'timeout';

export class SshConnectionFailure extends Error {
  readonly name: string = 'SshConnectionFailure';
  constructor(
    readonly kind: SshFailureKind,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

/** Bounded physical operations. Only the Host supervisor supplies retry policy. */
export interface SshConnectionControl {
  readIntent(id: string): Promise<boolean>;
  writeIntent(id: string, enabled: boolean): Promise<void>;
  establish(id: string, signal: AbortSignal): Promise<SshClientProxy>;
  reset(id: string): void;
  probe(id: string, signal: AbortSignal): Promise<void>;
}

/** Seeded by desktop composition before any persisted connection is restored. */
export interface SshConnectionLifecycle {
  connect(id: string): Promise<ConnectionState>;
  ensureConnected(id: string): Promise<ConnectionState>;
  disconnect(id: string): Promise<void>;
  invalidate(id: string): Promise<void>;
}
