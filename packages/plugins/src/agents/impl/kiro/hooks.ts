import {
  buildMinimalJsonHookConfig,
  makeStdinHookCommand,
} from '@emdash/core/agents/plugins/helpers';

export const KIRO_HOOKS_PATH = '.kiro/agents/emdash.json';

export function buildKiroHookConfig() {
  return buildMinimalJsonHookConfig(
    KIRO_HOOKS_PATH,
    [
      { hookKey: 'agentSpawn', command: makeStdinHookCommand('session') },
      { hookKey: 'userPromptSubmit', command: makeStdinHookCommand('start') },
      { hookKey: 'preToolUse', command: makeStdinHookCommand('start') },
      { hookKey: 'postToolUse', command: makeStdinHookCommand('start') },
      { hookKey: 'stop', command: makeStdinHookCommand('stop') },
    ],
    {
      name: 'emdash',
      description: 'Emdash-managed Kiro agent configuration for lifecycle hooks.',
    }
  );
}
