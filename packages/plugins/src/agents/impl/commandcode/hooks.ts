import {
  buildNestedJsonHookConfig,
  makeStdinHookCommand,
} from '@emdash/shared/agents/plugins/helpers';

export const COMMANDCODE_SETTINGS_PATH = '.commandcode/settings.json';

export function buildCommandCodeHookConfig() {
  return buildNestedJsonHookConfig(COMMANDCODE_SETTINGS_PATH, [
    { hookKey: 'Stop', command: makeStdinHookCommand('session') },
  ]);
}
