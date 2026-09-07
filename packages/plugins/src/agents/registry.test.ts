import { describe, expect, it } from 'vitest';
import { pluginRegistry } from './registry';

const GLOBAL_HOOK_PROVIDERS = [
  'amp',
  'auggie',
  'claude',
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
  'oh-my-pi',
  'opencode',
  'pi',
  'prime-agent',
  'qoder',
  'qwen',
].sort();

describe('agent plugin registry', () => {
  it('advertises Claude Fable 5.1', () => {
    const claude = pluginRegistry.get('claude');

    expect(claude).toBeDefined();
    expect(claude?.capabilities.models).toMatchObject({
      kind: 'selectable',
      modelOptions: {
        'claude-fable-5-1': {
          name: 'Claude Fable 5.1',
        },
      },
    });
  });

  it('advertises Claude Opus 5', () => {
    const claude = pluginRegistry.get('claude');

    expect(claude).toBeDefined();
    expect(claude?.capabilities.models).toMatchObject({
      kind: 'selectable',
      modelOptions: {
        'claude-opus-5': {
          name: 'Claude Opus 5',
        },
      },
    });
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
