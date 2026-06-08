import { describe, expect, it } from 'vitest';
import { parseClaudeTranscript } from './parse-claude';

const asst = (id: string, usage: object, extra: object = {}) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-05-30T17:12:46.766Z',
    sessionId: 'sess-1',
    cwd: '/Users/x/dev/garlic',
    requestId: 'req-' + id,
    message: { id, model: 'claude-opus-4-8', usage },
    ...extra,
  });

describe('parseClaudeTranscript', () => {
  it('extracts assistant usage records with token buckets', () => {
    const text = asst('msg_1', {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 5,
      cache_creation_input_tokens: 7,
    });
    const records = parseClaudeTranscript(text);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: 'msg_1',
      isMessage: true,
      provider: 'claude',
      model: 'claude-opus-4-8',
      cwd: '/Users/x/dev/garlic',
      sessionId: 'sess-1',
      input: 100,
      output: 20,
      cacheRead: 5,
      cacheWrite: 7,
    });
  });

  it('extracts user messages as zero-token records keyed by uuid', () => {
    const text = JSON.stringify({ type: 'user', uuid: 'u1', timestamp: 't', sessionId: 's' });
    const [r] = parseClaudeTranscript(text);
    expect(r).toMatchObject({ id: 'u1', isMessage: true, input: 0, output: 0 });
  });

  it('skips malformed lines and blank lines without throwing', () => {
    const text = ['not json', '', asst('msg_2', { input_tokens: 1, output_tokens: 1 })].join('\n');
    const records = parseClaudeTranscript(text);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('msg_2');
  });
});
