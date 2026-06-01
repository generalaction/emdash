import { describe, expect, it } from 'vitest';
import { parseCodexRollout } from './parse-codex';

const meta = JSON.stringify({
  type: 'session_meta',
  timestamp: '2026-05-30T20:26:13Z',
  payload: { id: 'cdx-1', cwd: '/Users/x/dev/f1-game' },
});
const turn = (model: string) =>
  JSON.stringify({ type: 'turn_context', timestamp: 't', payload: { model } });
const tokenCount = (input: number, cached: number, output: number) =>
  JSON.stringify({
    type: 'event_msg',
    timestamp: '2026-05-30T20:26:15Z',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          output_tokens: output,
        },
      },
    },
  });

describe('parseCodexRollout', () => {
  it('attributes cumulative-delta usage to the active model, subtracting cached from input', () => {
    // cumulative totals grow: first 100/40-cached/10-out, then 250/90/30
    const text = [meta, turn('gpt-5.4'), tokenCount(100, 40, 10), tokenCount(250, 90, 30)].join(
      '\n'
    );
    const records = parseCodexRollout(text, '/sessions/r.jsonl').filter((r) => !r.isMessage);
    expect(records).toHaveLength(2);
    // first delta: input 100, cached 40 -> input=60, cacheRead=40, output=10
    expect(records[0]).toMatchObject({
      model: 'gpt-5.4',
      input: 60,
      cacheRead: 40,
      output: 10,
      provider: 'codex',
      cwd: '/Users/x/dev/f1-game',
    });
    // second delta: inputD=150, cachedD=50 -> input=100, cacheRead=50, output=20
    expect(records[1]).toMatchObject({ input: 100, cacheRead: 50, output: 20 });
  });

  it('counts user/agent messages and gives every record a unique id', () => {
    const userMsg = JSON.stringify({
      type: 'event_msg',
      timestamp: 't',
      payload: { type: 'user_message' },
    });
    const agentMsg = JSON.stringify({
      type: 'event_msg',
      timestamp: 't',
      payload: { type: 'agent_message' },
    });
    const text = [meta, turn('gpt-5.5'), userMsg, agentMsg].join('\n');
    const records = parseCodexRollout(text, '/sessions/r.jsonl');
    const ids = new Set(records.map((r) => r.id));
    expect(ids.size).toBe(records.length);
    expect(records.filter((r) => r.isMessage)).toHaveLength(2);
  });
});
