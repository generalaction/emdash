import {
  createBoundExec,
  type BoundExec,
  type ExecBufferResult,
  type ExecOptions,
  type ExecResult,
} from '@emdash/core/exec';
import { GitRuntime } from '@emdash/core/git';
import { ResourceMap } from '@emdash/core/lib';
import type { Lease } from '@emdash/shared';
import { getDependencyManager } from '@main/core/dependencies/dependency-managers';
import { NON_INTERACTIVE_GIT_ENV } from '@main/core/execution-context/non-interactive-git-env';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { getGitExecutable } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';
import { ConstantHealthSource } from './health';
import { LegacySshGitRuntime } from './legacy/ssh-git';
import { machineKey, type MachineRef, type MachineRuntime, type RuntimeManager } from './types';

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
  readonly git = new GitRuntime({
    exec: new DynamicGitExec(process.cwd()),
    onError: (context, error) =>
      log.warn('Local GitRuntime background error', { context, error: String(error) }),
  });
  readonly health = new ConstantHealthSource();

  async dispose(): Promise<void> {
    await this.git.dispose();
  }
}

class SshMachineRuntime implements MachineRuntime {
  readonly machine: MachineRef;
  readonly git: LegacySshGitRuntime;
  readonly health = new ConstantHealthSource();

  constructor(
    connectionId: string,
    proxy: Awaited<ReturnType<typeof sshConnectionManager.connect>>
  ) {
    this.machine = { kind: 'ssh', connectionId };
    this.git = new LegacySshGitRuntime(proxy, connectionId);
  }

  async dispose(): Promise<void> {
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
  private readonly runtimes = new ResourceMap<MachineRuntime>({
    teardown: (_key, runtime) => runtime.dispose(),
    onError: (context, error) =>
      log.warn('RuntimeManager: runtime teardown failed', { context, error: String(error) }),
  });

  acquire(machine: MachineRef): Promise<Lease<MachineRuntime>> {
    return this.runtimes.acquire(machineKey(machine), async () => {
      await probeGitDependency(machine);
      if (machine.kind === 'local') return new LocalMachineRuntime();
      const proxy = await sshConnectionManager.connect(machine.connectionId);
      return new SshMachineRuntime(machine.connectionId, proxy);
    });
  }

  async dispose(): Promise<void> {
    await this.runtimes.dispose();
  }
}

export const runtimeManager = new DefaultRuntimeManager();
