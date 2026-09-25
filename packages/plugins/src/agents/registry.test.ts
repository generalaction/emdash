import { describe, expect, it } from 'vitest';
import { pluginRegistry } from './registry';

const GLOBAL_HOOK_PROVIDERS = [
  'amp',
  'antigravity',
  'auggie',
  'claude',
  'codebuddy',
  'codex',
  'commandcode',
  'copilot',
  'devin',
  'droid',
  'goose',
  'grok',
  'kilocode',
  'kimi',
  'kiro',
  'mimocode',
  'mistral',
  'muse',
  'oh-my-pi',
  'opencode',
  'pi',
  'prime-agent',
  'qoder',
  'qwen',
].sort();

describe('agent plugin registry', () => {
  it.each([
    ['claude', '--model', 'opus[1m]'],
    ['claude', '--model', 'claude-fable-5-1[1m]'],
    ['claude', '--model', 'sonnet'],
    ['claude', '--model', 'haiku'],
    ['codex', '-m', 'gpt-6-sol'],
    ['codex', '-m', 'gpt-6-luna'],
  ])('offers %s model %s %s and preserves its ID in terminal argv', (providerId, flag, model) => {
    const provider = pluginRegistry.get(providerId)!;
    const models = provider.capabilities.models;
    expect(models.kind).toBe('selectable');
    if (models.kind !== 'selectable') throw new Error('Expected selectable models');
    expect(models.modelOptions[model]).toBeDefined();

    const command = provider.behavior.prompt!.buildCommand({
      cli: providerId,
      autoApprove: false,
      isResuming: false,
      model,
    });
    expect(command.args).toEqual([flag, model]);
  });

  it('keeps every shipped hook integration user-global', () => {
    const hookProviders = pluginRegistry
      .getAll()
      .filter((provider) => provider.capabilities.hooks.kind !== 'none');

    expect(hookProviders.map((provider) => provider.metadata.id).sort()).toEqual(
      GLOBAL_HOOK_PROVIDERS
    );
    for (const provider of hookProviders) {
      expect(provider.capabilities.hooks).toMatchObject({ scope: 'global' });
    }
  });
});
