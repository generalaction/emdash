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
const tokenCountWithLast = (totalIn: number, totalOut: number, lastIn: number, lastOut: number) =>
  JSON.stringify({
    type: 'event_msg',
    timestamp: 't',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: totalIn,
          cached_input_tokens: 0,
          output_tokens: totalOut,
        },
        last_token_usage: { input_tokens: lastIn, cached_input_tokens: 0, output_tokens: lastOut },
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

  it('subtracts the inherited baseline for forked sessions (no double-count of parent history)', () => {
    const metaForked = JSON.stringify({
      type: 'session_meta',
      timestamp: 't',
      payload: { id: 'fork-1', cwd: '/x', forked_from_id: 'parent-1' },
    });
    // First token_count's total already includes 4900 inherited input / 180 inherited output;
    // only this turn (last) is 100 in / 20 out. Then a second turn adds 300 in / 60 out.
    const text = [
      metaForked,
      turn('gpt-5.5'),
      tokenCountWithLast(5000, 200, 100, 20),
      tokenCountWithLast(5300, 260, 300, 60),
    ].join('\n');
    const recs = parseCodexRollout(text, '/sessions/fork.jsonl').filter((r) => !r.isMessage);
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({ input: 100, output: 20 }); // inherited 4900/180 excluded
    expect(recs[1]).toMatchObject({ input: 300, output: 60 });
  });

  it('does NOT subtract a baseline for non-forked sessions (first total counts in full)', () => {
    const metaPlain = JSON.stringify({
      type: 'session_meta',
      timestamp: 't',
      payload: { id: 'plain-1', cwd: '/x' },
    });
    const text = [metaPlain, turn('gpt-5.5'), tokenCountWithLast(5000, 200, 100, 20)].join('\n');
    const recs = parseCodexRollout(text, '/sessions/p.jsonl').filter((r) => !r.isMessage);
    expect(recs[0]).toMatchObject({ input: 5000, output: 200 });
  });

  it('keys record ids by session id so a duplicated session file dedupes', () => {
    const text = [meta, turn('gpt-5.4'), tokenCount(100, 40, 10)].join('\n');
    const a = parseCodexRollout(text, '/sessions/2026/05/r.jsonl');
    const b = parseCodexRollout(text, '/archived_sessions/r.jsonl'); // same session, different path
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id)); // ids depend on session id, not path
    expect(a[0].id.startsWith('codex:cdx-1:')).toBe(true);
  });
});
