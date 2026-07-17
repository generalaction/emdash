import {
  mementoKeyId,
  mementosWireContract,
  type MementoModelKey,
  type MementoMutationError,
  type MementoRow,
} from '@core/primitives/mementos/api';
import type { Subject } from '@core/primitives/subjects/api';
import {
  createResourceCache,
  createScope,
  type ResourceCache,
  type Scope,
} from '@emdash/shared/concurrency';
import { err, ok, type Result } from '@emdash/shared/result';
import { createResourceLiveModelHost, LiveState, type ResourceLiveModelHost } from '@emdash/wire';
import type { MementoPersistenceService, MementoSweepPolicy } from './persistence';

type MementoState = LiveState<MementoRow | null>;

export interface MementoServiceOptions {
  readonly persistence: MementoPersistenceService;
  readonly scope?: Scope;
  readonly idleTtlMs?: number;
  readonly now?: () => number;
}

export class MementoService {
  readonly host: ResourceLiveModelHost<typeof mementosWireContract.memento>;

  private readonly persistence: MementoPersistenceService;
  private readonly scope: Scope;
  private readonly now: () => number;
  private readonly states = new Map<string, { key: MementoModelKey; state: MementoState }>();
  private readonly resources: ResourceCache<MementoModelKey, MementoState>;

  constructor(options: MementoServiceOptions) {
    this.persistence = options.persistence;
    this.scope = options.scope ?? createScope({ label: 'mementos-service' });
    this.now = options.now ?? Date.now;
    this.resources = createResourceCache({
      scope: this.scope,
      label: 'memento-states',
      idleTtlMs: options.idleTtlMs ?? 30_000,
      key: mementoKeyId,
      create: (key, entryScope) => {
        const state = new LiveState(this.persistence.getRow(key));
        const keyId = mementoKeyId(key);
        this.states.set(keyId, { key, state });
        entryScope.add(() => {
          if (this.states.get(keyId)?.state === state) this.states.delete(keyId);
          state.dispose();
        });
        return state;
      },
    });
    this.host = createResourceLiveModelHost(mementosWireContract.memento, {
      acquire: (key) => this.resources.acquire(key),
      states: {
        value: ({ resource }) => resource,
      },
      mutations: {
        save: async ({ resource, key, input, settle }) =>
          this.runPersistenceMutation(async () => {
            const row = { ...input, updatedAt: this.now() };
            this.persistence.upsert(key, row);
            await settle('value', resource.replace(row));
          }),
        reset: async ({ resource, key, settle }) =>
          this.runPersistenceMutation(async () => {
            this.persistence.deleteRow(key);
            await settle('value', resource.replace(null));
          }),
      },
      toMutationError: (_name, error) => toMementoError(error),
    });

    this.scope.add(() => this.host.dispose());
    this.scope.add(() => this.persistence.close());
  }

  deleteBySubject(subject: Subject): Result<{ deleted: number }, MementoMutationError> {
    try {
      const deleted = this.persistence.deleteBySubject(subject);
      for (const { key, state } of this.states.values()) {
        if (key.kind === subject.kind && key.key === subject.key) state.replace(null);
      }
      return ok({ deleted });
    } catch (error) {
      return err(toMementoError(error));
    }
  }

  deleteAll(): Result<{ deleted: number }, MementoMutationError> {
    try {
      const deleted = this.persistence.deleteAll();
      for (const { state } of this.states.values()) state.replace(null);
      return ok({ deleted });
    } catch (error) {
      return err(toMementoError(error));
    }
  }

  deleteOrphans(
    kind: string,
    validKeys: readonly string[]
  ): Result<{ deleted: number }, MementoMutationError> {
    try {
      const { deleted, orphanKeys } = this.persistence.deleteOrphans(kind, validKeys);
      const orphans = new Set(orphanKeys);
      for (const { key, state } of this.states.values()) {
        if (key.kind === kind && orphans.has(key.key)) state.replace(null);
      }
      return ok({ deleted });
    } catch (error) {
      return err(toMementoError(error));
    }
  }

  sweep(policies: readonly MementoSweepPolicy[], now = Date.now()): number {
    return this.persistence.sweep(policies, now);
  }

  async dispose(): Promise<void> {
    await this.scope.dispose();
  }

  private async runPersistenceMutation(
    operation: () => Promise<void>
  ): Promise<Result<void, MementoMutationError>> {
    try {
      await operation();
      return ok<void>();
    } catch (error) {
      return err(toMementoError(error));
    }
  }
}

function toMementoError(error: unknown): MementoMutationError {
  return {
    code: 'persistence',
    message: error instanceof Error ? error.message : String(error),
  };
}
