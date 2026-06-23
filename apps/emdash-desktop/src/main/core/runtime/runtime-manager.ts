import { FileTreeRuntime } from '@emdash/core/file-tree';
import { GitRuntime } from '@emdash/core/git';
import { ResourceMap } from '@emdash/core/lib';
import type { Lease } from '@emdash/shared';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { log } from '@main/lib/logger';
import { ConstantHealthSource } from './health';
import { LegacySshFileTreeRuntime } from './legacy/ssh-file-tree';
import { LegacySshGitRuntime } from './legacy/ssh-git';
import { machineKey, type MachineRef, type MachineRuntime, type RuntimeManager } from './types';

class LocalMachineRuntime implements MachineRuntime {
  readonly machine: MachineRef = { kind: 'local' };
  readonly fileTree = new FileTreeRuntime({
    onError: (context, error) =>
      log.warn('Local FileTreeRuntime background error', { context, error: String(error) }),
  });
  readonly git = new GitRuntime({
    onError: (context, error) =>
      log.warn('Local GitRuntime background error', { context, error: String(error) }),
  });
  readonly health = new ConstantHealthSource();

  dispose(): void {
    void this.fileTree.dispose();
    void this.git.dispose();
  }
}

class SshMachineRuntime implements MachineRuntime {
  readonly machine: MachineRef;
  readonly fileTree: LegacySshFileTreeRuntime;
  readonly git: LegacySshGitRuntime;
  readonly health = new ConstantHealthSource();

  constructor(
    connectionId: string,
    proxy: Awaited<ReturnType<typeof sshConnectionManager.connect>>
  ) {
    this.machine = { kind: 'ssh', connectionId };
    this.fileTree = new LegacySshFileTreeRuntime(proxy);
    this.git = new LegacySshGitRuntime(proxy);
  }

  dispose(): void {
    void this.fileTree.dispose();
    this.git.dispose();
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

  dispose(): void {
    this.runtimes.dispose();
  }
}

export const runtimeManager: RuntimeManager = new DefaultRuntimeManager();
