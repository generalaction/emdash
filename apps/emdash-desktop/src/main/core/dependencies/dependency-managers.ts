import type { Platform } from '@emdash/core/deps';
import { HostDependencyManager, type DependencyProbeOptions } from '@emdash/core/deps/runtime';
import { clearResolvedPathCache } from '@main/core/conversations/impl/resolve-agent-executable';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { appSettingsService } from '@main/core/settings/settings-service';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { resolveLocalAutomationShellWithSystemFallback } from '@main/core/terminal-shell/resolver';
import { log } from '@main/lib/logger';
import { agentUpdateService } from './agent-update-service';
import { hostDependencyStore } from './host-dependency-store';
import { createLocalInstallCommandRunner, createSshInstallCommandRunner } from './install-runner';
import { DEPENDENCIES, AGENT_DEPENDENCIES, getDependencyDescriptor } from './registry';

async function resolveLocalInstallShellProfile() {
  const { defaultShell } = await appSettingsService.get('terminal');
  return await resolveLocalAutomationShellWithSystemFallback({
    intent: defaultShell,
    onFallback: (error) => {
      log.warn('[DependencyManager] Preferred install shell unavailable, using fallback', {
        shell: error.shell,
        target: error.target,
      });
    },
  });
}

function wireDesktopBridges(manager: HostDependencyManager, connectionId?: string): void {
  // AgentUpdateService owns the enriched event emission (adds latestVersion/updateAvailable)
  agentUpdateService.attach(manager, connectionId);
  manager.onExecutableInvalidated.subscribe(({ id }: { id: string }) => {
    clearResolvedPathCache(id, connectionId);
  });
}

export const localDependencyManager = new HostDependencyManager(new LocalExecutionContext(), {
  runInstallCommand: createLocalInstallCommandRunner(resolveLocalInstallShellProfile),
  getSelection: (depId) => hostDependencyStore.getSelection('local', depId),
  logger: log,
  dependencies: DEPENDENCIES,
  getDependencyDescriptor,
});
wireDesktopBridges(localDependencyManager, undefined);

const sshManagers = new Map<string, HostDependencyManager>();
const sshManagerPromises = new Map<string, Promise<HostDependencyManager>>();
const agentProbePromises = new WeakMap<HostDependencyManager, Promise<void>>();

/** Resolve the OS platform of a remote machine via a lightweight `uname -s` probe. */
async function resolveRemotePlatform(ctx: IExecutionContext): Promise<Platform> {
  try {
    const { stdout } = await ctx.exec('uname', ['-s'], { timeout: 5000 });
    const os = stdout.trim().toLowerCase();
    if (os === 'darwin') return 'macos';
    return 'linux';
  } catch {
    return 'linux';
  }
}

export async function getDependencyManager(connectionId?: string): Promise<HostDependencyManager> {
  if (!connectionId) return localDependencyManager;
  const existing = sshManagers.get(connectionId);
  if (existing) return existing;

  const pending = sshManagerPromises.get(connectionId);
  if (pending) return pending;

  const promise = createSshDependencyManager(connectionId)
    .then((mgr) => {
      if (sshManagerPromises.get(connectionId) === promise) {
        wireDesktopBridges(mgr, connectionId);
        sshManagers.set(connectionId, mgr);
      }
      return mgr;
    })
    .finally(() => {
      if (sshManagerPromises.get(connectionId) === promise) {
        sshManagerPromises.delete(connectionId);
      }
    });
  sshManagerPromises.set(connectionId, promise);
  return promise;
}

async function createSshDependencyManager(connectionId: string): Promise<HostDependencyManager> {
  const proxy = await sshConnectionManager.connect(connectionId);
  const sshCtx = new SshExecutionContext(proxy);
  const platform = await resolveRemotePlatform(sshCtx);
  const mgr = new HostDependencyManager(sshCtx, {
    runInstallCommand: createSshInstallCommandRunner(proxy),
    connectionId,
    platform,
    getSelection: (depId) => hostDependencyStore.getSelection(connectionId, depId),
    logger: log,
    dependencies: DEPENDENCIES,
    getDependencyDescriptor,
  });
  return mgr;
}

export function clearDependencyManager(connectionId: string): void {
  sshManagers.delete(connectionId);
  sshManagerPromises.delete(connectionId);
}

export async function ensureAgentDependenciesProbed(
  manager: HostDependencyManager,
  options: DependencyProbeOptions = { refreshShellEnv: true }
): Promise<void> {
  if (AGENT_DEPENDENCIES.every((dependency) => manager.get(dependency.id) !== undefined)) return;

  const existing = agentProbePromises.get(manager);
  if (existing) {
    await existing;
    return;
  }

  const promise = manager.probeCategory('agent', options).finally(() => {
    agentProbePromises.delete(manager);
  });
  agentProbePromises.set(manager, promise);
  await promise;
}
