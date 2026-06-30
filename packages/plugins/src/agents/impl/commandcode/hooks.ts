import {
  buildNestedJsonHookConfig,
  makeStdinHookCommand,
} from '@emdash/core/agents/plugins/helpers';

export const COMMANDCODE_SETTINGS_PATH = '.commandcode/settings.json';

export function buildCommandCodeHookConfig() {
  return buildNestedJsonHookConfig(COMMANDCODE_SETTINGS_PATH, [
    { hookKey: 'Stop', command: makeStdinHookCommand('session') },
    { hookKey: 'Stop', command: makeStdinHookCommand('stop') },
  ]);
}
