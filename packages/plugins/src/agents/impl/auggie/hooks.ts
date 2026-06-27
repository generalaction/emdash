import {
  buildNestedJsonHookConfig,
  makeStdinHookCommand,
} from '@emdash/core/agents/plugins/helpers';

export const AUGGIE_HOOKS_PATH = '.augment/settings.json';

export function buildAuggieHookConfig() {
  return buildNestedJsonHookConfig(AUGGIE_HOOKS_PATH, [
    { hookKey: 'SessionStart', command: makeStdinHookCommand('session') },
    { hookKey: 'PromptSubmit', command: makeStdinHookCommand('start') },
    { hookKey: 'PreToolUse', command: makeStdinHookCommand('start') },
    { hookKey: 'PostToolUse', command: makeStdinHookCommand('start') },
    { hookKey: 'Stop', command: makeStdinHookCommand('stop') },
    { hookKey: 'SessionEnd', command: makeStdinHookCommand('stop') },
    { hookKey: 'Notification', command: makeStdinHookCommand('notification') },
  ]);
}
