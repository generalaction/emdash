import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import nodePath from 'node:path';
import {
  createBoundExec,
  type BoundExec,
  type ExecBufferResult,
  type ExecOptions,
  type ExecResult,
  type ExecSpawnOptions,
} from '@emdash/core/exec';
import { contains, FilesRuntime } from '@emdash/core/files';
import { spawnFsWatchWorker } from '@emdash/core/services/fs-watch/worker';
import { GitRuntime } from '@emdash/runtime/git';
import type { Lease } from '@emdash/shared';
import { createResourceCache } from '@emdash/wire/util';
import { appScope } from '@main/app/app-scope';
import { getDependencyManager } from '@main/core/dependencies/dependency-managers';
import { NON_INTERACTIVE_GIT_ENV } from '@main/core/execution-context/non-interactive-git-env';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { getGitExecutable } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';
import { desktopWorkerPath } from '@main/worker-manifest';
import { ConstantHealthSource } from './health';
import { LegacySshFilesRuntime } from './legacy/ssh-files';
import { LegacySshGitRuntime } from './legacy/ssh-git';
import {
  machineKey,
  type MachineRef,
  type MachineRuntime,
  type RuntimeManager,
  type RuntimePath,
} from './types';

const nativeRuntimePath: RuntimePath = {
  join: (...parts) => nodePath.join(...parts),
  dirname: (p) => nodePath.dirname(p),
  basename: (p) => nodePath.basename(p),
  isAbsolute: (p) => nodePath.isAbsolute(p),
  relative: (from, to) => nodePath.relative(from, to),
  contains,
};

class DynamicGitExec implements BoundExec {
  readonly file = 'git';
  readonly env = {
    ...process.env,
    ...NON_INTERACTIVE_GIT_ENV,
    LC_ALL: 'C',
    LANG: 'C',
    LANGUAGE: 'C',
  };

  constructor(
    readonly cwd: string,
    private readonly connectionId?: string
  ) {}

  exec(args: string[], options?: ExecOptions): Promise<ExecResult> {
    return this.current().exec(args, options);
  }

  execStreaming(
    args: string[],
    onStdout: (chunk: string) => boolean | void,
    options?: ExecOptions
  ): Promise<void> {
    return this.current().execStreaming(args, onStdout, options);
  }

  execBuffer(args: string[], options?: ExecOptions): Promise<ExecBufferResult> {
    return this.current().execBuffer(args, options);
  }

  spawn(args: string[], options?: ExecSpawnOptions): ChildProcessWithoutNullStreams {
    return this.current().spawn(args, options);
  }

  withCwd(cwd: string): BoundExec {
    return new DynamicGitExec(cwd, this.connectionId);
  }

  private current(): BoundExec {
    return createBoundExec({
      file: getGitExecutable(this.connectionId),
      cwd: this.cwd,
      env: this.env,
    });
  }
}

class LocalMachineRuntime implements MachineRuntime {
  readonly machine: MachineRef = { kind: 'local' };
  private readonly scope = appScope.child('local-machine-runtime');
  private readonly watcher = spawnFsWatchWorker({
    entry: desktopWorkerPath('fs-watch'),
    scope: this.scope,
    env: process.env,
    onError: (context, error) =>
      log.warn('File watching background error', { context, error: String(error) }),
  });
  readonly files = Object.assign(
    new FilesRuntime({
      watcher: this.watcher,
      onError: (context, error) =>
        log.warn('Local file runtime background error', { context, error: String(error) }),
    }),
    { path: nativeRuntimePath }
  );
  readonly git = new GitRuntime({
    exec: new DynamicGitExec(process.cwd()),
    watcher: this.watcher,
    onError: (context, error) =>
      log.warn('Local GitRuntime background error', { context, error: String(error) }),
  });
  readonly health = new ConstantHealthSource();

  async dispose(): Promise<void> {
    await this.files.dispose();
    await this.git.dispose();
    await this.watcher.dispose();
    await this.scope.dispose();
  }
}

class SshMachineRuntime implements MachineRuntime {
  readonly machine: MachineRef;
  readonly files: LegacySshFilesRuntime;
  readonly git: LegacySshGitRuntime;
  readonly health = new ConstantHealthSource();

  constructor(
    connectionId: string,
    proxy: Awaited<ReturnType<typeof sshConnectionManager.connect>>
  ) {
    this.machine = { kind: 'ssh', connectionId };
    this.files = new LegacySshFilesRuntime(proxy);
    this.git = new LegacySshGitRuntime(proxy, connectionId);
  }

  async dispose(): Promise<void> {
    await this.files.dispose();
    await this.git.dispose();
  }
}

async function probeGitDependency(machine: MachineRef): Promise<void> {
  try {
    const manager = await getDependencyManager(
      machine.kind === 'ssh' ? machine.connectionId : undefined
    );
    await manager.probe('git');
  } catch (error) {
    log.warn('RuntimeManager: Git dependency probe failed', {
      machine: machineKey(machine),
      error: String(error),
    });
  }
}

class DefaultRuntimeManager implements RuntimeManager {
  private readonly runtimes = createResourceCache<MachineRef, MachineRuntime>({
    key: machineKey,
    scope: appScope,
    label: 'machine-runtimes',
    onError: (error, key) =>
      log.warn('RuntimeManager: runtime creation failed', { key, error: String(error) }),
    create: async (machine, scope) => {
      await probeGitDependency(machine);
      const runtime =
        machine.kind === 'local'
          ? new LocalMachineRuntime()
          : new SshMachineRuntime(
              machine.connectionId,
              await sshConnectionManager.connect(machine.connectionId)
            );
      scope.add(() => runtime.dispose());
      return runtime;
    },
  });

  acquire(machine: MachineRef): Promise<Lease<MachineRuntime>> {
    const lease = this.runtimes.acquire(machine);
    return lease.ready().then((runtime) => ({ value: runtime, release: lease.release }));
  }

  async dispose(): Promise<void> {
    await this.runtimes.dispose();
  }
}

export const runtimeManager = new DefaultRuntimeManager();
