import {
  buildNestedJsonHookConfig,
  makeNotificationHookCommand,
  makeStdinHookCommand,
} from '@emdash/shared/agents/plugins/helpers';

export const DEVIN_HOOKS_PATH = '.devin/hooks.v1.json';

export function buildDevinHookConfig() {
  return buildNestedJsonHookConfig(DEVIN_HOOKS_PATH, [
    { hookKey: 'Stop', command: makeStdinHookCommand('stop') },
    { hookKey: 'SessionEnd', command: makeStdinHookCommand('stop') },
    { hookKey: 'PermissionRequest', command: makeNotificationHookCommand('permission_prompt') },
  ]);
}
