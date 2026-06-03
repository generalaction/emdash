import { describe, expect, it } from 'vitest';
import { parsePiTranscript } from './parse-pi';

const modelChange = (provider: string, modelId: string) =>
  JSON.stringify({ type: 'model_change', provider, modelId });

const assistant = (usage: object, extra: object = {}) =>
  JSON.stringify({
    type: 'message',
    timestamp: '2026-06-01T10:00:00Z',
    cwd: '/Users/x/dev/app',
    message: { role: 'assistant', usage, ...extra },
  });

describe('parsePiTranscript', () => {
  it('attributes assistant usage to the active model from model_change', () => {
    const text = [
      modelChange('anthropic', 'claude-sonnet-4-5'),
      assistant({
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 7,
      }),
    ].join('\n');
    const recs = parsePiTranscript(text, '/pi/s.jsonl');
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      provider: 'pi',
      vendor: 'anthropic',
      isMessage: true,
      model: 'claude-sonnet-4-5',
      cwd: '/Users/x/dev/app',
      input: 100,
      output: 20,
      cacheRead: 5,
      cacheWrite: 7,
    });
  });

  it('accepts camelCase usage field variants', () => {
    const text = [
      modelChange('openai', 'gpt-5.5'),
      assistant({ inputTokens: 50, outputTokens: 10, cacheReadTokens: 3, cacheCreationTokens: 2 }),
    ].join('\n');
    const [r] = parsePiTranscript(text, '/pi/s.jsonl');
    expect(r).toMatchObject({
      vendor: 'openai',
      model: 'gpt-5.5',
      input: 50,
      output: 10,
      cacheRead: 3,
      cacheWrite: 2,
    });
  });

  it('captures the vendor from model_change so non-Anthropic/OpenAI models can price', () => {
    const text = [
      modelChange('google', 'gemini-2.5-pro'),
      assistant({ input_tokens: 10, output_tokens: 2 }),
    ].join('\n');
    const [r] = parsePiTranscript(text, '/pi/s.jsonl');
    expect(r).toMatchObject({ vendor: 'google', model: 'gemini-2.5-pro' });
  });

  it('falls back to the model-id prefix for the vendor when provider is absent', () => {
    const text = assistant({ input_tokens: 1 }, { model: 'mistral/large' });
    const [r] = parsePiTranscript(text, '/pi/s.jsonl');
    expect(r).toMatchObject({ vendor: 'mistral', model: 'large' });
  });

  it('strips a provider/ prefix from the model id', () => {
    const text = [
      modelChange('anthropic', 'anthropic/claude-opus-4-8'),
      assistant({ input_tokens: 1 }),
    ].join('\n');
    expect(parsePiTranscript(text, '/pi/s.jsonl')[0].model).toBe('claude-opus-4-8');
  });

  it('counts user messages as zero-token records', () => {
    const text = [
      JSON.stringify({ type: 'message', timestamp: 't', message: { role: 'user' } }),
      modelChange('anthropic', 'claude-sonnet-4-5'),
      assistant({ input_tokens: 10, output_tokens: 2 }),
    ].join('\n');
    const recs = parsePiTranscript(text, '/pi/s.jsonl');
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({ isMessage: true, input: 0, output: 0, model: null });
    expect(recs[1]).toMatchObject({ input: 10, output: 2 });
  });

  it('skips malformed lines and prefers an explicit message model', () => {
    const text = [
      'not json',
      modelChange('anthropic', 'claude-sonnet-4-5'),
      assistant({ input_tokens: 1 }, { model: 'claude-opus-4-8' }),
    ].join('\n');
    const recs = parsePiTranscript(text, '/pi/s.jsonl');
    expect(recs).toHaveLength(1);
    expect(recs[0].model).toBe('claude-opus-4-8'); // explicit message model wins over model_change
  });
});
