import { describe, expect, it } from 'vitest';
import {
  AGENT_MODEL_SUPPORT,
  buildAgentModelArgs,
  getAgentModelSupport,
  getReasoningOptions,
  MODEL_SELECTABLE_PROVIDER_IDS,
  providerSupportsModelSelection,
  sanitizeAgentModelSelection,
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

  it('exposes provider-level reasoning only where reasoning is model-independent', () => {
    // Codex/Claude/Amp share a single effort flag across models.
    expect(getAgentModelSupport('codex')?.reasoning?.length).toBeGreaterThan(0);
    expect(getAgentModelSupport('claude')?.reasoning?.length).toBeGreaterThan(0);
    expect(getAgentModelSupport('amp')?.reasoning?.length).toBeGreaterThan(0);
    // Cursor bakes reasoning into the model id, so there is no provider-level list.
    expect(getAgentModelSupport('cursor')?.reasoning).toBeUndefined();
  });
});

describe('getReasoningOptions', () => {
  it('returns provider-level reasoning for Codex regardless of model', () => {
    expect(getReasoningOptions('codex', undefined).length).toBeGreaterThan(0);
    expect(getReasoningOptions('codex', 'gpt-5.5').length).toBeGreaterThan(0);
  });

  it('returns per-model reasoning for Cursor and nothing for Default/Auto', () => {
    expect(getReasoningOptions('cursor', undefined)).toEqual([]);
    expect(getReasoningOptions('cursor', 'auto')).toEqual([]);
    expect(getReasoningOptions('cursor', 'composer-2.5')).toEqual([]);
    expect(getReasoningOptions('cursor', 'gpt-5.5').map((o) => o.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });

  it('omits reasoning for Amp rush but offers it for smart/deep/default', () => {
    expect(getReasoningOptions('amp', 'rush')).toEqual([]);
    expect(getReasoningOptions('amp', 'smart').length).toBeGreaterThan(0);
    expect(getReasoningOptions('amp', 'deep').length).toBeGreaterThan(0);
    expect(getReasoningOptions('amp', undefined).length).toBeGreaterThan(0);
  });
});

describe('sanitizeAgentModelSelection', () => {
  it('clears stale reasoning when the selected model does not support it', () => {
    expect(
      sanitizeAgentModelSelection('cursor', { model: 'auto', reasoningEffort: 'high' })
    ).toEqual({ model: 'auto' });
  });

  it('clears reasoning-only patches when no reasoning is available for the model', () => {
    expect(
      sanitizeAgentModelSelection('cursor', { model: 'composer-2.5', reasoningEffort: 'high' })
    ).toEqual({ model: 'composer-2.5' });
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
    expect(
      buildAgentModelArgs('claude', { model: 'claude-opus-4-8', reasoningEffort: 'max' })
    ).toEqual(['--model', 'claude-opus-4-8', '--effort', 'max']);
  });

  it('lists the disabled claude fable model but never passes it to the CLI', () => {
    const fable = getAgentModelSupport('claude')?.models.find(
      (option) => option.id === 'claude-fable-5'
    );
    expect(fable?.disabled).toBe(true);
    // A stale stored selection of a disabled model must not reach the agent.
    expect(buildAgentModelArgs('claude', { model: 'claude-fable-5' })).toEqual([]);
    expect(
      buildAgentModelArgs('claude', { model: 'claude-fable-5', reasoningEffort: 'high' })
    ).toEqual([]);
  });

  it('builds amp mode args and includes --effort for smart/deep', () => {
    expect(buildAgentModelArgs('amp', { model: 'smart', reasoningEffort: 'high' })).toEqual([
      '--mode',
      'smart',
      '--effort',
      'high',
    ]);
    expect(buildAgentModelArgs('amp', { model: 'smart', reasoningEffort: 'none' })).toEqual([
      '--mode',
      'smart',
      '--effort',
      'none',
    ]);
  });

  it('ignores reasoning effort for amp rush', () => {
    expect(buildAgentModelArgs('amp', { model: 'rush', reasoningEffort: 'high' })).toEqual([
      '--mode',
      'rush',
    ]);
  });

  it('composes the cursor model id from the base model and reasoning level', () => {
    expect(buildAgentModelArgs('cursor', { model: 'gpt-5.5', reasoningEffort: 'high' })).toEqual([
      '--model',
      'gpt-5.5-high',
    ]);
    // Reasoning suffix differs per family (gpt-5.5 uses extra-high, gpt-5.4 uses xhigh).
    expect(buildAgentModelArgs('cursor', { model: 'gpt-5.5', reasoningEffort: 'xhigh' })).toEqual([
      '--model',
      'gpt-5.5-extra-high',
    ]);
    expect(buildAgentModelArgs('cursor', { model: 'gpt-5.4', reasoningEffort: 'xhigh' })).toEqual([
      '--model',
      'gpt-5.4-xhigh',
    ]);
    expect(
      buildAgentModelArgs('cursor', { model: 'claude-4.6-sonnet', reasoningEffort: 'thinking' })
    ).toEqual(['--model', 'claude-4.6-sonnet-medium-thinking']);
  });

  it('uses the cursor default model id when no reasoning level is chosen', () => {
    expect(buildAgentModelArgs('cursor', { model: 'gpt-5.5' })).toEqual([
      '--model',
      'gpt-5.5-medium',
    ]);
    expect(buildAgentModelArgs('cursor', { model: 'auto', reasoningEffort: 'high' })).toEqual([
      '--model',
      'auto',
    ]);
  });

  it('keeps registry model/reasoning ids unique per provider', () => {
    for (const support of Object.values(AGENT_MODEL_SUPPORT) as AgentModelSupport[]) {
      const modelIds = support.models.map((model) => model.id);
      expect(new Set(modelIds).size).toBe(modelIds.length);
      if (support.reasoning) {
        const effortIds = support.reasoning.map((option) => option.id);
        expect(new Set(effortIds).size).toBe(effortIds.length);
      }
      for (const model of support.models) {
        if (model.reasoning) {
          const ids = model.reasoning.map((option) => option.id);
          expect(new Set(ids).size).toBe(ids.length);
        }
      }
    }
  });
});
