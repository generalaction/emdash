import {
  buildNestedJsonHookConfig,
  makeStdinHookCommand,
} from '@emdash/shared/agents/plugins/helpers';

export const QWEN_HOOKS_PATH = '.qwen/settings.json';

export function buildQwenHookConfig() {
  return buildNestedJsonHookConfig(QWEN_HOOKS_PATH, [
    { hookKey: 'PermissionRequest', command: makeStdinHookCommand('notification') },
    { hookKey: 'Stop', command: makeStdinHookCommand('stop') },
    { hookKey: 'SessionEnd', command: makeStdinHookCommand('stop') },
  ]);
}
