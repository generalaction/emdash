import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import { cell, expose, type Cell, type LeasedLiveModelProvider } from '@emdash/wire';
import { peek } from '@emdash/wire';
import { type OperationProgress, type OperationRecord } from '@primitives/kernel/api';
import { createOperationEngine, type OperationEngine } from '@primitives/kernel/engine';
import { SqliteOperationStore, operationStoreSqlite } from '@primitives/kernel/sqlite';
import {
  createWorktreeOperation,
  removeRepositoryOperation,
  removeWorktreeOperation,
  workspaceHostContract,
  type WorkspaceHostError,
  type WorkspaceHostOperationInput,
  type WorkspaceHostOperationView,
  type WorkspaceHostOperationsList,
  type WorkspaceHostRepoSnapshot,
  type WorkspaceHostSnapshotRequest,
  type WorkspaceHostSubmitOperationResult,
} from '../api';
import {
  createCreateWorktreeHandler,
  createRemoveRepositoryHandler,
  createRemoveWorktreeHandler,
  type GitExecFactory,
} from './handlers';
import { scanRepository, type ScanRepositoryOptions } from './scanner/scan-repository';
import type { WorkspaceHostSessionClients } from './session/session-cleanup';

export type WorkspaceHostOperationsLiveHost = LeasedLiveModelProvider<
  typeof workspaceHostContract.operations
>;

export interface WorkspaceHostRuntimeOptions {
  stateDirectory: string;
  sessions: WorkspaceHostSessionClients;
  scope?: Scope;
  createGitExec?: GitExecFactory;
  scanOptions?: Omit<ScanRepositoryOptions, 'exec'>;
  now?: () => number;
}

export class WorkspaceHostRuntime {
  readonly operationsHost: WorkspaceHostOperationsLiveHost;

  private readonly operationLog: Cell<WorkspaceHostOperationsList>;
  private readonly engine: OperationEngine;
  private readonly store: SqliteOperationStore;
  private readonly handle: ReturnType<typeof operationStoreSqlite.open>;
  private readonly progress = new Map<string, OperationProgress>();
  private readonly now: () => number;

  constructor(private readonly options: WorkspaceHostRuntimeOptions) {
    this.now = options.now ?? Date.now;
    this.operationLog = cell({} satisfies WorkspaceHostOperationsList);
    this.operationsHost = expose(
      workspaceHostContract.operations,
      { list: this.operationLog },
      { publish: { list: 'diff' } }
    );

    const dbPath = join(options.stateDirectory, 'workspace-host-operations.db');
    mkdirSync(dirname(dbPath), { recursive: true });
    this.handle = operationStoreSqlite.open(dbPath);
    this.store = new SqliteOperationStore(this.handle, {
      now: this.now,
      onJournalAppend: (transition) => {
        void this.refreshOperation(transition.operationId);
      },
    });
    const handlers = [
      createCreateWorktreeHandler({
        sessions: options.sessions,
        createGitExec: options.createGitExec,
      }),
      createRemoveWorktreeHandler({
        sessions: options.sessions,
        createGitExec: options.createGitExec,
      }),
      createRemoveRepositoryHandler({
        sessions: options.sessions,
        createGitExec: options.createGitExec,
      }),
    ];
    this.engine = createOperationEngine({
      store: this.store,
      registry: {
        definitions: [createWorktreeOperation, removeWorktreeOperation, removeRepositoryOperation],
        handlers,
        conflictPolicies: [],
      },
      progress: {
        publish: (update) => {
          this.progress.set(update.operationId, update);
          void this.refreshOperation(update.operationId);
        },
        end: (operationId) => {
          this.progress.delete(operationId);
          void this.refreshOperation(operationId);
        },
      },
      clock: {
        now: this.now,
        setTimeout: (callback, ms) => setTimeout(callback, ms),
      },
    });

    void this.engine.recover().then(() => this.refreshOperations());
    options.scope?.add(() => this.dispose());
  }

  async snapshotRepository(
    request: WorkspaceHostSnapshotRequest
  ): Promise<Result<WorkspaceHostRepoSnapshot, WorkspaceHostError>> {
    return scanRepository(request, this.options.scanOptions);
  }

  async submitOperation(
    request: WorkspaceHostOperationInput
  ): Promise<Result<WorkspaceHostSubmitOperationResult, WorkspaceHostError>> {
    const submitted = await this.engine.submit(definitionFor(request), request.input, {
      initiator: { kind: 'user', action: request.verb },
    });
    if (!submitted.success) {
      return err({
        type: 'operation-admission-failed',
        message: `Could not submit ${request.verb}: ${submitted.error.kind}`,
      });
    }
    await this.refreshOperation(submitted.data.id);
    return ok({
      operationId: request.input.operationId,
      kernelOperationId: submitted.data.id,
    });
  }

  async getOperation(
    operationId: string
  ): Promise<Result<WorkspaceHostOperationView | null, WorkspaceHostError>> {
    const record = await this.findRecordByOperationId(operationId);
    return ok(record ? this.viewFor(record) : null);
  }

  async dispose(): Promise<void> {
    await this.engine.shutdown();
    this.handle.close();
  }

  private async refreshOperations(): Promise<void> {
    const page = await this.engine.query({
      name: [
        createWorktreeOperation.name,
        removeWorktreeOperation.name,
        removeRepositoryOperation.name,
      ],
      limit: 500,
    });
    this.operationLog.set(
      Object.fromEntries(page.records.map((record) => [record.key, this.viewFor(record)]))
    );
  }

  private async refreshOperation(kernelOperationId: string): Promise<void> {
    const record = await this.engine.get(kernelOperationId);
    if (!record) return;
    this.operationLog.set({
      ...peek(this.operationLog),
      [record.key]: this.viewFor(record),
    });
  }

  private async findRecordByOperationId(operationId: string): Promise<OperationRecord | undefined> {
    const page = await this.engine.query({
      name: [
        createWorktreeOperation.name,
        removeWorktreeOperation.name,
        removeRepositoryOperation.name,
      ],
      limit: 500,
    });
    return page.records.find((record) => record.key === operationId);
  }

  private viewFor(record: OperationRecord): WorkspaceHostOperationView {
    const progress = this.progress.get(record.id);
    return {
      operationId: record.key,
      kernelOperationId: record.id,
      verb: verbForRecord(record),
      status: record.status,
      stages: progress?.stages ?? [],
      updatedAt: record.updatedAt,
      ...(record.error
        ? {
            error: {
              type: 'operation-rejected' as const,
              message: record.error.message,
              code: record.error.code,
            },
          }
        : {}),
    };
  }
}

function definitionFor(request: WorkspaceHostOperationInput) {
  switch (request.verb) {
    case 'host.createWorktree':
      return createWorktreeOperation;
    case 'host.removeWorktree':
      return removeWorktreeOperation;
    case 'host.removeRepository':
      return removeRepositoryOperation;
  }
}

function verbForRecord(record: OperationRecord): WorkspaceHostOperationView['verb'] {
  switch (record.name) {
    case createWorktreeOperation.name:
    case removeWorktreeOperation.name:
    case removeRepositoryOperation.name:
      return record.name;
    default:
      throw new Error(`Unknown workspace host operation: ${record.name}`);
  }
}
