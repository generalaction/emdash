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
  it('advertises Claude models by the ids its chat model selector uses', () => {
    const models = pluginRegistry.get('claude')?.capabilities.models;

    expect(models?.kind).toBe('selectable');
    expect(models?.kind === 'selectable' && Object.keys(models.modelOptions)).toEqual([
      'opus[1m]',
      'claude-fable-5-1[1m]',
      'sonnet',
      'haiku',
    ]);
  });

  it('advertises Codex models by the ids its chat model selector uses', () => {
    const models = pluginRegistry.get('codex')?.capabilities.models;

    expect(models?.kind).toBe('selectable');
    expect(models?.kind === 'selectable' && Object.keys(models.modelOptions)).toEqual([
      'gpt-6-astra',
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
    ]);
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
