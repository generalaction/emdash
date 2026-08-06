import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import { cell, expose, type Cell, type LeasedLiveModelProvider } from '@emdash/wire';
import { formatAbsolute, parseAbsolute, type HostAbsolutePath } from '@primitives/path/api';
import {
  workspaceHostContract,
  type WorkspaceHostError,
  type WorkspaceHostInitializeRequest,
  type WorkspaceHostInitializeResult,
  type WorkspaceHostMeasureUsageRequest,
  type WorkspaceHostNotice,
  type WorkspaceHostNoticesList,
  type WorkspaceHostRunScriptRequest,
  type WorkspaceHostRunScriptResult,
  type WorkspaceHostUsage,
} from '../api';
import type { GitExecFactory } from './git-exec';
import { measureWorkspaceUsage } from './measure-usage';
import { WorkspaceInitManager, type WorkspaceNotice } from './session-init/workspace-init-manager';

export type WorkspaceHostNoticesLiveHost = LeasedLiveModelProvider<
  typeof workspaceHostContract.notices
>;

export interface WorkspaceHostRuntimeOptions {
  stateDirectory: string;
  scope?: Scope;
  createGitExec?: GitExecFactory;
  now?: () => number;
}

export class WorkspaceHostRuntime {
  readonly noticesHost: WorkspaceHostNoticesLiveHost;

  private readonly noticesLog: Cell<WorkspaceHostNoticesList>;
  private readonly initManager: WorkspaceInitManager;
  private readonly now: () => number;

  constructor(private readonly options: WorkspaceHostRuntimeOptions) {
    this.now = options.now ?? Date.now;
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

    cleanupLegacyOperationsDatabase(options.stateDirectory);
    options.scope?.add(() => this.dispose());
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
    await this.initManager.dispose();
  }
}

/**
 * Best-effort removal of the retired operations-kernel SQLite store (ADR 0006
 * demolition). Older builds kept a per-daemon operation log under the state
 * directory; nothing reads or writes it anymore. Failures are swallowed — an
 * undeletable orphan must never block the runtime from starting.
 */
function cleanupLegacyOperationsDatabase(stateDirectory: string): void {
  const basePath = join(stateDirectory, 'workspace-host-operations.db');
  for (const path of [basePath, `${basePath}-wal`, `${basePath}-shm`]) {
    try {
      rmSync(path, { force: true });
    } catch {
      // Best effort only.
    }
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
