import { describe, expect, it } from 'vitest';
import {
  AGENT_MODEL_SUPPORT,
  buildAgentModelArgs,
  getAgentModelSupport,
  MODEL_SELECTABLE_PROVIDER_IDS,
  providerSupportsModelSelection,
  type AgentModelSupport,
} from './agent-models';

describe('agent-models registry', () => {
  it('exposes only the curated providers as model-selectable', () => {
    expect(MODEL_SELECTABLE_PROVIDER_IDS.slice().sort()).toEqual([
      'amp',
      'claude',
      'codex',
      'cursor',
    ]);
    expect(providerSupportsModelSelection('codex')).toBe(true);
    expect(providerSupportsModelSelection('amp')).toBe(true);
    expect(providerSupportsModelSelection('gemini')).toBe(false);
  });

  it('only attaches reasoning options when the provider supports an effort flag', () => {
    expect(getAgentModelSupport('cursor')?.reasoning).toBeUndefined();
    expect(getAgentModelSupport('amp')?.reasoning).toBeUndefined();
    expect(getAgentModelSupport('codex')?.reasoning?.length).toBeGreaterThan(0);
    expect(getAgentModelSupport('claude')?.reasoning?.length).toBeGreaterThan(0);
  });
});

describe('buildAgentModelArgs', () => {
  it('returns no args for providers without model support', () => {
    expect(buildAgentModelArgs('gemini', { model: 'whatever' })).toEqual([]);
  });

  it('returns no args for an empty selection', () => {
    expect(buildAgentModelArgs('codex', undefined)).toEqual([]);
    expect(buildAgentModelArgs('codex', {})).toEqual([]);
    expect(buildAgentModelArgs('codex', { model: '   ' })).toEqual([]);
  });

  it('builds codex model + reasoning effort args', () => {
    expect(buildAgentModelArgs('codex', { model: 'gpt-5.5', reasoningEffort: 'high' })).toEqual([
      '--model',
      'gpt-5.5',
      '-c',
      'model_reasoning_effort=high',
    ]);
  });

  it('ignores stale or invalid selection values', () => {
    expect(
      buildAgentModelArgs('codex', { model: 'old-model', reasoningEffort: 'extreme' })
    ).toEqual([]);
    expect(buildAgentModelArgs('codex', { model: 'gpt-5.5', reasoningEffort: 'extreme' })).toEqual([
      '--model',
      'gpt-5.5',
    ]);
  });

  it('builds codex reasoning-only args when no model is chosen', () => {
    expect(buildAgentModelArgs('codex', { reasoningEffort: 'minimal' })).toEqual([
      '-c',
      'model_reasoning_effort=minimal',
    ]);
  });

  it('builds claude model + effort args', () => {
    expect(buildAgentModelArgs('claude', { model: 'opus', reasoningEffort: 'max' })).toEqual([
      '--model',
      'opus',
      '--effort',
      'max',
    ]);
  });

  it('builds amp mode args via --mode and ignores any reasoning effort', () => {
    expect(buildAgentModelArgs('amp', { model: 'rush', reasoningEffort: 'high' })).toEqual([
      '--mode',
      'rush',
    ]);
  });

  it('builds cursor model args and ignores any reasoning effort', () => {
    expect(
      buildAgentModelArgs('cursor', {
        model: 'claude-4.5-sonnet-thinking',
        reasoningEffort: 'high',
      })
    ).toEqual(['--model', 'claude-4.5-sonnet-thinking']);
  });

  it('keeps registry model/reasoning ids unique per provider', () => {
    for (const support of Object.values(AGENT_MODEL_SUPPORT) as AgentModelSupport[]) {
      const modelIds = support.models.map((m) => m.id);
      expect(new Set(modelIds).size).toBe(modelIds.length);
      if (support.reasoning) {
        const effortIds = support.reasoning.map((r) => r.id);
        expect(new Set(effortIds).size).toBe(effortIds.length);
      }
    }
  });
});
