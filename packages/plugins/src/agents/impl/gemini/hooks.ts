import {
  buildNestedJsonHookConfig,
  makeStdinHookCommand,
} from '@emdash/core/agents/plugins/helpers';

export const GEMINI_SETTINGS_PATH = '.gemini/settings.json';

export function buildGeminiHookConfig() {
  return buildNestedJsonHookConfig(GEMINI_SETTINGS_PATH, [
    { hookKey: 'SessionStart', command: makeStdinHookCommand('session') },
    { hookKey: 'BeforeAgent', command: makeStdinHookCommand('start') },
    { hookKey: 'AfterAgent', command: makeStdinHookCommand('stop') },
    { hookKey: 'Notification', command: makeStdinHookCommand('notification') },
    { hookKey: 'SessionEnd', command: makeStdinHookCommand('stop') },
  ]);
}
