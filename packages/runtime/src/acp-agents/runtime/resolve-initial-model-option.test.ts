import { describe, expect, it } from 'vitest';
import { resolveInitialModelOption } from './resolve-initial-model-option';

const catalog = {
  'claude-opus-4-8': { aliases: ['opus[1m]', 'opus'] },
  'claude-fable-5': { aliases: ['claude-fable-5[1m]', 'fable'] },
};

describe('resolveInitialModelOption', () => {
  it('keeps a requested model when ACP offers that exact id', () => {
    expect(resolveInitialModelOption('opus', ['default', 'opus'], catalog)).toBe('opus');
  });

  it('maps a catalog id to the alias offered by ACP', () => {
    expect(
      resolveInitialModelOption('claude-opus-4-8', ['default', 'opus', 'opus[1m]'], catalog)
    ).toBe('opus[1m]');
    expect(
      resolveInitialModelOption('claude-fable-5', ['default', 'claude-fable-5[1m]'], catalog)
    ).toBe('claude-fable-5[1m]');
  });

  it('does not select a model that the ACP session does not offer', () => {
    expect(resolveInitialModelOption('claude-opus-4-8', ['default', 'haiku'], catalog)).toBeNull();
    expect(resolveInitialModelOption('custom-model', ['default'], catalog)).toBeNull();
  });
});
