import {
  buildNestedJsonHookConfig,
  makeStdinHookCommand,
} from '@emdash/shared/agents/plugins/helpers';

export const DROID_HOOKS_PATH = '.factory/settings.json';

export function buildDroidHookConfig() {
  return buildNestedJsonHookConfig(DROID_HOOKS_PATH, [
    { hookKey: 'Notification', command: makeStdinHookCommand('notification') },
    { hookKey: 'Stop', command: makeStdinHookCommand('stop') },
    { hookKey: 'SessionStart', command: makeStdinHookCommand('session') },
  ]);
}
