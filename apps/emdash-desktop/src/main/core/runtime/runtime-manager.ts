import { FilesRuntime } from '@emdash/core/files';
import { GitRuntime } from '@emdash/core/git';
import { ResourceMap } from '@emdash/core/lib';
import type { Lease } from '@emdash/shared';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { log } from '@main/lib/logger';
import { ConstantHealthSource } from './health';
import { LegacySshFilesRuntime } from './legacy/ssh-files';
import { LegacySshGitRuntime } from './legacy/ssh-git';
import { machineKey, type MachineRef, type MachineRuntime, type RuntimeManager } from './types';

class LocalMachineRuntime implements MachineRuntime {
  readonly machine: MachineRef = { kind: 'local' };
  readonly files = new FilesRuntime({
    onError: (context, error) =>
      log.warn('Local file runtime background error', { context, error: String(error) }),
  });
  readonly git = new GitRuntime({
    onError: (context, error) =>
      log.warn('Local GitRuntime background error', { context, error: String(error) }),
  });
  readonly health = new ConstantHealthSource();

  async dispose(): Promise<void> {
    await this.files.dispose();
    await this.git.dispose();
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
    this.git = new LegacySshGitRuntime(proxy);
  }

  async dispose(): Promise<void> {
    await this.files.dispose();
    await this.git.dispose();
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
