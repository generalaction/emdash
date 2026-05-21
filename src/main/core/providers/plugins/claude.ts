import { claudeTrustService } from '@main/core/agent-hooks/claude-trust-service';
import { makeStdinHookCommand, mergeHookEntries } from '../internal/hook-commands';
import { createProviderPlugin } from '../types';

const CLAUDE_SETTINGS_PATH = '.claude/settings.local.json';

const HOOK_EVENT_MAP = [
  { eventType: 'notification', hookKey: 'Notification' },
  { eventType: 'stop', hookKey: 'Stop' },
] as const;

export const claudePlugin = createProviderPlugin(
  ({ readProjectFile, writeProjectFile, platform }) => ({
    supportsHooks: true,
    gitIgnorePaths: [CLAUDE_SETTINGS_PATH],

    async writeHookConfig() {
      const raw = await readProjectFile(CLAUDE_SETTINGS_PATH);
      const config: Record<string, unknown> = raw
        ? ((JSON.parse(raw) as Record<string, unknown>) ?? {})
        : {};

      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;

      for (const { eventType, hookKey } of HOOK_EVENT_MAP) {
        const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        hooks[hookKey] = mergeHookEntries(existing, makeStdinHookCommand(eventType, platform));
      }

      await writeProjectFile(
        CLAUDE_SETTINGS_PATH,
        JSON.stringify({ ...config, hooks }, null, 2) + '\n'
      );
      return true;
    },

    async prepareSession({ projectPath, homedir }) {
      await claudeTrustService.maybeAutoTrustLocal({
        providerId: 'claude',
        cwd: projectPath,
        homedir,
      });
    },
  })
);
