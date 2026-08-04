import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import { cell, expose, type Cell, type LeasedLiveModelProvider } from '@emdash/wire';
import { peek } from '@emdash/wire';
import { type OperationProgress, type OperationRecord } from '@primitives/kernel/api';
import { createOperationEngine, type OperationEngine } from '@primitives/kernel/engine';
import { SqliteOperationStore, operationStoreSqlite } from '@primitives/kernel/sqlite';
import { projectOperationStages } from '@primitives/operations/api';
import { formatAbsolute, parseAbsolute, type HostAbsolutePath } from '@primitives/path/api';
import {
  createWorktreeOperation,
  removeRepositoryOperation,
  removeWorktreeOperation,
  workspaceHostContract,
  type WorkspaceHostError,
  type WorkspaceHostInitializeRequest,
  type WorkspaceHostInitializeResult,
  type WorkspaceHostMeasureUsageRequest,
  type WorkspaceHostNotice,
  type WorkspaceHostNoticesList,
  type WorkspaceHostOperationInput,
  type WorkspaceHostOperationView,
  type WorkspaceHostOperationsList,
  type WorkspaceHostRepoSnapshot,
  type WorkspaceHostRunScriptRequest,
  type WorkspaceHostRunScriptResult,
  type WorkspaceHostSnapshotRequest,
  type WorkspaceHostSubmitOperationResult,
  type WorkspaceHostUsage,
} from '../api';
import {
  createCreateWorktreeHandler,
  createRemoveRepositoryHandler,
  createRemoveWorktreeHandler,
  type GitExecFactory,
} from './handlers';
import { measureWorkspaceUsage } from './measure-usage';
import { scanRepository, type ScanRepositoryOptions } from './scanner/scan-repository';
import { WorkspaceInitManager, type WorkspaceNotice } from './session-init/workspace-init-manager';
import type { WorkspaceHostSessionClients } from './session/session-cleanup';

export type WorkspaceHostOperationsLiveHost = LeasedLiveModelProvider<
  typeof workspaceHostContract.operations
>;
export type WorkspaceHostNoticesLiveHost = LeasedLiveModelProvider<
  typeof workspaceHostContract.notices
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
  readonly noticesHost: WorkspaceHostNoticesLiveHost;

  private readonly operationLog: Cell<WorkspaceHostOperationsList>;
  private readonly noticesLog: Cell<WorkspaceHostNoticesList>;
  private readonly initManager: WorkspaceInitManager;
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
    this.noticesLog = cell({} satisfies WorkspaceHostNoticesList);
    this.noticesHost = expose(
      workspaceHostContract.notices,
      { list: this.noticesLog },
      { publish: { list: 'diff' } }
    );
    this.initManager = new WorkspaceInitManager({
      now: this.now,
      onNoticesChanged: (notices) => {
        this.noticesLog.set(
          Object.fromEntries(
            Object.entries(notices).map(([workspacePath, workspaceNotices]) => [
              workspacePath,
              workspaceNotices.map(noticeView),
            ])
          )
        );
      },
    });

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
        initManager: this.initManager,
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

  async initializeWorkspace(
    request: WorkspaceHostInitializeRequest,
    signal?: AbortSignal
  ): Promise<Result<WorkspaceHostInitializeResult, WorkspaceHostError>> {
    try {
      const result = await this.initManager.initialize(
        formatWorkspacePath(request.workspacePath),
        signal
      );
      return ok({
        active: true,
        prepare: result.prepare,
        notices: result.notices.map(noticeView),
      });
    } catch (error) {
      return err({
        type: 'filesystem-error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async measureUsage(
    request: WorkspaceHostMeasureUsageRequest,
    signal?: AbortSignal
  ): Promise<Result<WorkspaceHostUsage, WorkspaceHostError>> {
    return measureWorkspaceUsage({
      workspacePath: request.workspacePath,
      signal,
      createGitExec: this.options.createGitExec,
    });
  }

  async runWorkspaceScript(
    request: WorkspaceHostRunScriptRequest,
    signal?: AbortSignal
  ): Promise<Result<WorkspaceHostRunScriptResult, WorkspaceHostError>> {
    try {
      const workspacePath = formatWorkspacePath(request.workspacePath);
      if (!this.initManager.isActive(workspacePath)) {
        return err({
          type: 'operation-rejected',
          code: 'workspace-not-active',
          message: `Workspace ${workspacePath} must be initialized before running scripts`,
        });
      }
      const result = await this.initManager.runConfiguredScript(
        workspacePath,
        request.script,
        signal
      );
      return ok(result);
    } catch (error) {
      return err({
        type: 'filesystem-error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async dispose(): Promise<void> {
    await this.engine.shutdown();
    await this.initManager.dispose();
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
    // A terminal record can coexist with a fresh resubmission under the same
    // client operation id; the latest record is the authoritative view.
    return page.records
      .filter((record) => record.key === operationId)
      .reduce<OperationRecord | undefined>(
        (latest, record) => (latest === undefined || record.seq > latest.seq ? record : latest),
        undefined
      );
  }

  private viewFor(record: OperationRecord): WorkspaceHostOperationView {
    const progress = this.progress.get(record.id);
    return {
      operationId: record.key,
      kernelOperationId: record.id,
      verb: verbForRecord(record),
      status: record.status,
      stages: projectOperationStages(record, progress),
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

function noticeView(notice: WorkspaceNotice): WorkspaceHostNotice {
  const path = parseAbsolute(notice.path, {
    profile: { style: isWindowsPath(notice.path) ? 'win32' : 'posix' },
  });
  if (!path.success) throw new Error(`Workspace notice has invalid path: ${notice.path}`);
  return {
    ...notice,
    path: path.data,
  };
}

function formatWorkspacePath(path: HostAbsolutePath): string {
  return formatAbsolute(path, { separator: path.root.kind === 'posix' ? '/' : '\\' });
}

function isWindowsPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/u.test(path) || path.startsWith('\\\\');
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
