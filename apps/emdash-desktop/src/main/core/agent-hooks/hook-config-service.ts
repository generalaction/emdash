import { homedir } from 'node:os';
import { createPluginFs } from '@main/core/agents/plugin-fs';
import { getPlugin } from '@main/core/agents/plugin-registry';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';

const GITIGNORE_PATH = '.gitignore';

async function ensureGitIgnoreEntries(taskPath: string, entries: string[]): Promise<void> {
  const wsFs = createPluginFs(taskPath);
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
 * Keeps the user's injection preference separate from installation success.
 * A failed refresh must not change the default-on spawn environment, while an
 * explicit opt-out must disable config writes and runtime hook injection.
 */
export async function ensureHooksInstalled({
  providerId,
  taskPath,
}: {
  providerId: string;
  taskPath: string;
}): Promise<{ hooksAvailable: boolean; injectionEnabled: boolean }> {
  let injectionEnabled = true;

  try {
    const localProjectSettings = await appSettingsService.get('localProject');
    injectionEnabled = localProjectSettings.injectAgentNotificationHooks ?? true;
    if (!injectionEnabled) return { hooksAvailable: false, injectionEnabled };

    const writeGitIgnoreEntries = localProjectSettings.writeAgentConfigToGitIgnore ?? true;

    const plugin = getPlugin(providerId);
    const hooksDescriptor = plugin.capabilities.hooks;
    const hooksKind = hooksDescriptor.kind;
    let hooksAvailable = false;

    let writtenPaths: string[] = [];

    if (hooksKind === 'config' && plugin.behavior.hooks) {
      const scope = hooksDescriptor.scope;
      const root = scope === 'global' ? homedir() : taskPath;
      const fs = createPluginFs(root);
      const paths = await plugin.behavior.hooks.writeHooks(fs, []);
      // For global-scope hooks the paths are relative to homedir; don't add
      // them to the workspace .gitignore (they live in the user's home).
      writtenPaths = scope === 'global' ? [] : paths;
      hooksAvailable = true;
    } else if (hooksKind === 'plugin' && plugin.behavior.plugins) {
      const fs = createPluginFs(taskPath);
      writtenPaths = await plugin.behavior.plugins.installPlugin(fs, {
        kind: 'workspace',
        path: taskPath,
      });
      hooksAvailable = true;
    }

    if (writeGitIgnoreEntries && writtenPaths.length > 0) {
      await ensureGitIgnoreEntries(taskPath, writtenPaths);
    }

    return { hooksAvailable, injectionEnabled };
  } catch (error) {
    log.warn('HookConfigService: failed to ensure hooks installed', {
      providerId,
      taskPath,
      error: String(error),
    });
    return { hooksAvailable: false, injectionEnabled };
  }
}
