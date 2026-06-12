import type { Platform } from '@emdash/shared/deps';
import { HostDependencyManager } from '@emdash/shared/deps/runtime';
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
import { DEPENDENCIES, getDependencyDescriptor } from './registry';

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
  manager.onExecutableInvalidated.subscribe(({ id }) => {
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
  let mgr = sshManagers.get(connectionId);
  if (!mgr) {
    const proxy = await sshConnectionManager.connect(connectionId);
    const sshCtx = new SshExecutionContext(proxy);
    const platform = await resolveRemotePlatform(sshCtx);
    mgr = new HostDependencyManager(sshCtx, {
      runInstallCommand: createSshInstallCommandRunner(proxy),
      connectionId,
      platform,
      getSelection: (depId) => hostDependencyStore.getSelection(connectionId, depId),
      logger: log,
      dependencies: DEPENDENCIES,
      getDependencyDescriptor,
    });
    wireDesktopBridges(mgr, connectionId);
    sshManagers.set(connectionId, mgr);
  }
  return mgr;
}
