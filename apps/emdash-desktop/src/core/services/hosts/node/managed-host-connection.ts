import {
  runtimeHostUnavailable,
  type RuntimeResolveError,
} from '@emdash/core/primitives/runtime-resolution/api';
import { err, ok, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type { HostConnection } from '../api/node/host-connection';
import {
  HostConnectionSupervisor,
  type HostConnectionSupervisorOptions,
} from './connection-supervisor';
import { translateHostPreparationError } from './runtime-resolution';

export type ManagedHostConnectionOptions = Omit<HostConnectionSupervisorOptions, 'intent'> & {
  intent: { read(): Promise<boolean>; write(enabled: boolean): Promise<void> };
};

/** Owns connection intent. The composed supervisor owns its execution and evidence. */
export class ManagedHostConnection implements HostConnection {
  readonly supervisor: HostConnectionSupervisor;
  readonly availability;
  private readonly scope: Scope;
  private readonly leases = new Set<object>();
  private enabled: boolean | undefined;
  private pinned = false;
  private intentRevision = 0;
  private stopRevision = 0;
  private intentWrites: Promise<void> = Promise.resolve();
  private intentRead: Promise<void> | undefined;

  constructor(private readonly options: ManagedHostConnectionOptions) {
    this.scope = options.scope.child('managed-host-connection');
    this.supervisor = new HostConnectionSupervisor({
      ...options,
      scope: this.scope,
      intent: {
        enabled: () => this.enabled,
        runtimeWanted: () => this.pinned || this.leases.size > 0,
        restore: () => this.restore(),
        maintainRuntime: () => {
          this.pinned = true;
        },
      },
    });
    this.availability = this.supervisor.availability;
  }

  lease(owner: Scope): void {
    if (owner.disposed || this.scope.disposed) return;
    const lease = {};
    this.leases.add(lease);
    owner.add(() => {
      this.leases.delete(lease);
      this.supervisor.releaseRuntime();
    });
    void this.restore().catch(() => {});
  }

  pin(): Promise<Result<void, RuntimeResolveError>> {
    return this.result(this.requestPin(true));
  }

  disconnect(): Promise<Result<void, RuntimeResolveError>> {
    return this.result(this.stop());
  }

  /** Internal SSH-only entry point; persisted permission does not imply a runtime pin. */
  async connectSsh(): Promise<void> {
    await this.requestPin(false);
    await this.supervisor.ensureSsh();
  }

  async restore(): Promise<void> {
    this.assertActive();
    if (this.enabled === undefined) {
      const revision = this.intentRevision;
      this.intentRead ??= this.options.intent
        .read()
        .then((enabled) => {
          if (this.scope.disposed || this.intentRevision !== revision) return;
          this.enabled = enabled;
        })
        .catch((error: unknown) => {
          if (!this.scope.disposed && this.intentRevision === revision)
            this.supervisor.intentFailed(error);
          throw error;
        })
        .finally(() => {
          this.intentRead = undefined;
        });
      await this.intentRead;
    }
    this.supervisor.restoreIntent();
  }

  dispose(): Promise<void> {
    return this.scope.dispose();
  }

  private async requestPin(runtime: boolean): Promise<void> {
    this.assertActive();
    this.supervisor.assertCanConnect(runtime);
    this.intentRevision += 1;
    const stopRevision = this.stopRevision;
    try {
      await this.writeIntent(true);
    } catch (error) {
      if (!this.scope.disposed && this.stopRevision === stopRevision)
        this.supervisor.intentFailed(error);
      throw error;
    }
    if (this.stopRevision !== stopRevision || this.scope.disposed)
      throw new Error('Host Connect was superseded');
    this.supervisor.assertCanConnect(runtime);
    this.enabled = true;
    this.pinned ||= runtime;
    this.supervisor.activate(runtime);
  }

  private async stop(): Promise<void> {
    this.assertActive();
    this.stopRevision += 1;
    this.intentRevision += 1;
    this.enabled = false;
    this.pinned = false;
    this.supervisor.stop();
    try {
      await this.writeIntent(false);
    } catch (error) {
      throw runtimeHostUnavailable(
        this.options.host,
        'runtime-unavailable',
        `Could not persist disconnected intent: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private writeIntent(enabled: boolean): Promise<void> {
    const write = this.intentWrites.catch(() => {}).then(() => this.options.intent.write(enabled));
    this.intentWrites = write;
    return write;
  }

  private assertActive(): void {
    if (this.scope.disposed)
      throw runtimeHostUnavailable(
        this.options.host,
        'runtime-unavailable',
        'Host identity disposed'
      );
  }

  private async result(work: Promise<void>): Promise<Result<void, RuntimeResolveError>> {
    try {
      await work;
      return ok();
    } catch (error) {
      return err(translateHostPreparationError(this.options.host, 'handshaking', error));
    }
  }
}
