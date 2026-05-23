import { createDroidClassifier } from '@main/core/agent-hooks/classifiers/droid';
import { makeStdinHookCommand, mergeHookEntries } from '../internal/hook-commands';
import { createProviderPlugin } from '../types';

const DROID_SETTINGS_PATH = '.factory/settings.json';

const HOOK_EVENT_MAP = [
  { hookKey: 'Notification', eventType: 'notification' },
  { hookKey: 'Stop', eventType: 'stop' },
] as const;

export const droidPlugin = createProviderPlugin(
  ({ readProjectFile, writeProjectFile, platform }) => ({
    supportsHooks: true,
    gitIgnorePaths: [DROID_SETTINGS_PATH],
    createClassifier: createDroidClassifier,

    async writeHookConfig() {
      const raw = await readProjectFile(DROID_SETTINGS_PATH);
      const config: Record<string, unknown> = raw
        ? ((JSON.parse(raw) as Record<string, unknown>) ?? {})
        : {};

      const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;

      for (const { hookKey, eventType } of HOOK_EVENT_MAP) {
        const existing = Array.isArray(hooks[hookKey]) ? hooks[hookKey] : [];
        hooks[hookKey] = mergeHookEntries(existing, makeStdinHookCommand(eventType, platform));
      }

      await writeProjectFile(
        DROID_SETTINGS_PATH,
        JSON.stringify({ ...config, hooks }, null, 2) + '\n'
      );
      return true;
    },
  })
);
