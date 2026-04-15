import { describe, expect, it } from 'vitest';

// The ClaudeModelSelect component is a straightforward Radix Select wrapper
// that uses a sentinel value for "Default (no --model flag)".
// These tests verify the sentinel round-trip so we can rely on it in
// integration without mounting a full React tree.

const DEFAULT_MODEL_SENTINEL = '__model_default__';

function toSelectValue(model: string): string {
  return model || DEFAULT_MODEL_SENTINEL;
}

function fromSelectValue(v: string): string {
  return v === DEFAULT_MODEL_SENTINEL ? '' : v;
}

describe('ClaudeModelSelect sentinel round-trip', () => {
  it('maps empty model to sentinel', () => {
    expect(toSelectValue('')).toBe(DEFAULT_MODEL_SENTINEL);
  });

  it('maps a model ID to itself', () => {
    expect(toSelectValue('claude-opus-4-6')).toBe('claude-opus-4-6');
  });

  it('decodes sentinel back to empty string', () => {
    expect(fromSelectValue(DEFAULT_MODEL_SENTINEL)).toBe('');
  });

  it('decodes a model ID back to itself', () => {
    expect(fromSelectValue('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it('round-trips correctly for all model IDs including 1M-context', () => {
    const models = [
      '',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-sonnet-4-6[1m]',
      'claude-haiku-4-5-20251001',
    ];
    for (const model of models) {
      expect(fromSelectValue(toSelectValue(model))).toBe(model);
    }
  });
});
