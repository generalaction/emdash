import { homedir } from 'node:os';
import type { PluginFs } from '@emdash/core/agents/plugins';
import { createPluginFs } from '@main/core/agents/plugin-fs';
import { getPlugin } from '@main/core/agents/plugin-registry';
import { createRemotePluginFs } from '@main/core/agents/remote-plugin-fs';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { IFilesRuntime } from '@main/core/runtime/types';
import { appSettingsService } from '@main/core/settings/settings-service';
import { resolveRemoteHome } from '@main/core/ssh/lifecycle/remote-shell-profile';
import { log } from '@main/lib/logger';

const GITIGNORE_PATH = '.gitignore';

/**
 * Where the agent that will consume these hooks actually runs. Remote agents
 * need the config written on the remote box, not on the machine running the
 * desktop app.
 */
export type HookInstallHost =
  | { kind: 'local' }
  | { kind: 'ssh'; ctx: IExecutionContext; files: IFilesRuntime };

/** Lazily resolved plugin filesystems for the workspace and the agent's home. */
type HookInstallTarget = {
  workspace: PluginFs;
  global: () => Promise<PluginFs>;
};

async function resolveHookInstallTarget(
  host: HookInstallHost,
  taskPath: string
): Promise<HookInstallTarget> {
  if (host.kind === 'local') {
    return {
      workspace: createPluginFs(taskPath),
      global: async () => createPluginFs(homedir()),
    };
  }

  const opened = host.files.fileSystem();
  if (!opened.success) {
    throw new Error(`failed to open remote filesystem: ${opened.error.message}`);
  }

  const remoteFs = opened.data;
  return {
    workspace: createRemotePluginFs(host.ctx, remoteFs, taskPath),
    global: async () => createRemotePluginFs(host.ctx, remoteFs, await resolveRemoteHome(host.ctx)),
  };
}

async function ensureGitIgnoreEntries(wsFs: PluginFs, entries: string[]): Promise<void> {
  const existing = (await wsFs.read(GITIGNORE_PATH)) ?? '';
  const existingLines = existing
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  const isIgnored = (entry: string) => {
    const norm = entry.replace(/^\/+/, '');
    return existingLines.some((raw) => {
      const p = raw.replace(/^\/+/, '');
      if (p === norm) return true;
      if (p.endsWith('/')) return norm.startsWith(p);
      if (p.endsWith('/**')) return norm.startsWith(p.slice(0, -2));
      return false;
    });
  };

  const missing = entries.filter((e) => !isIgnored(e));
  if (missing.length === 0) return;

  const content = existing.replace(/\s*$/, '');
  const next =
    content.length > 0 ? `${content}\n${missing.join('\n')}\n` : `${missing.join('\n')}\n`;
  await wsFs.write(GITIGNORE_PATH, next);
}

/**
 * Ensures hooks and plugins are installed for the given provider on every
 * conversation spawn. Writes are idempotent (small-file merges), so re-writing
 * before every spawn removes the "config got cleaned mid-task" failure mode.
 *
 * Returns true if hooks are available for this provider (i.e. hook env vars
 * should be injected into the PTY spawn).
 */
export async function ensureHooksInstalled({
  providerId,
  taskPath,
  host = { kind: 'local' },
}: {
  providerId: string;
  taskPath: string;
  host?: HookInstallHost;
}): Promise<boolean> {
  try {
    const localProjectSettings = await appSettingsService.get('localProject');
    const writeGitIgnoreEntries = localProjectSettings.writeAgentConfigToGitIgnore ?? true;

    const plugin = getPlugin(providerId);
    const hooksDescriptor = plugin.capabilities.hooks;
    const hooksKind = hooksDescriptor.kind;
    let hooksAvailable = false;

    let writtenPaths: string[] = [];
    const target = await resolveHookInstallTarget(host, taskPath);

    if (hooksKind === 'config' && plugin.behavior.hooks) {
      const scope = hooksDescriptor.scope;
      const fs = scope === 'global' ? await target.global() : target.workspace;
      const paths = await plugin.behavior.hooks.writeHooks(fs, []);
      // For global-scope hooks the paths are relative to homedir; don't add
      // them to the workspace .gitignore (they live in the user's home).
      writtenPaths = scope === 'global' ? [] : paths;
      hooksAvailable = true;
    } else if (hooksKind === 'plugin' && plugin.behavior.plugins) {
      writtenPaths = await plugin.behavior.plugins.installPlugin(target.workspace, {
        kind: 'workspace',
        path: taskPath,
      });
      hooksAvailable = true;
    }

    if (writeGitIgnoreEntries && writtenPaths.length > 0) {
      await ensureGitIgnoreEntries(target.workspace, writtenPaths);
    }

    return hooksAvailable;
  } catch (error) {
    log.warn('HookConfigService: failed to ensure hooks installed', {
      providerId,
      taskPath,
      error: String(error),
    });
    return false;
  }
}
