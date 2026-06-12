import {
  buildNestedJsonHookConfig,
  makeStdinHookCommand,
} from '@emdash/shared/agents/plugins/helpers';

export const CLAUDE_SETTINGS_PATH = '.claude/settings.local.json';

export function buildClaudeHookConfig() {
  return buildNestedJsonHookConfig(CLAUDE_SETTINGS_PATH, [
    { hookKey: 'Notification', command: makeStdinHookCommand('notification') },
    { hookKey: 'Stop', command: makeStdinHookCommand('stop') },
  ]);
}
