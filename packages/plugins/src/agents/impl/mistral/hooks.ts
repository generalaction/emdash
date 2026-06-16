import type { PluginFs } from '@emdash/shared/agents/plugins';
import {
  buildFlatTomlHookConfig,
  makeNotificationHookCommand,
  makeStdinHookCommand,
  readTomlConfig,
  writeTomlConfig,
} from '@emdash/shared/agents/plugins/helpers';

export const MISTRAL_HOOKS_PATH = '.vibe/hooks.toml';
export const MISTRAL_CONFIG_PATH = '.vibe/config.toml';

const MISTRAL_HOOK_ENTRIES = [
  {
    name: 'emdash-post-agent-turn',
    type: 'post_agent_turn',
    command: makeStdinHookCommand('stop'),
    timeout: 10,
    strict: false,
    description: 'Notify Emdash when Mistral Vibe finishes an agent turn.',
  },
  {
    name: 'emdash-ask-user-question',
    type: 'before_tool',
    match: 'ask_user_question',
    command: makeNotificationHookCommand('permission_prompt'),
    timeout: 10,
    strict: false,
    description: 'Notify Emdash when Mistral Vibe asks for user input.',
  },
];

async function enableExperimentalHooks(fs: PluginFs): Promise<string[]> {
  const config = await readTomlConfig(fs, MISTRAL_CONFIG_PATH);
  await writeTomlConfig(fs, MISTRAL_CONFIG_PATH, {
    ...config,
    enable_experimental_hooks: true,
  });
  return [MISTRAL_CONFIG_PATH];
}

export function buildMistralHookConfig() {
  return buildFlatTomlHookConfig(MISTRAL_HOOKS_PATH, MISTRAL_HOOK_ENTRIES, {
    beforeWrite: async (fs) => {
      await readTomlConfig(fs, MISTRAL_CONFIG_PATH);
    },
    afterWrite: enableExperimentalHooks,
  });
}
