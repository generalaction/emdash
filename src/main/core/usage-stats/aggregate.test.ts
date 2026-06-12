import { describe, expect, it } from 'vitest';
import { aggregate } from './aggregate';
import type { UsageRecord } from './types';

const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  id: 'x',
  isMessage: false,
  provider: 'claude',
  vendor: 'anthropic',
  ts: '2026-05-30T12:00:00Z',
  model: 'claude-opus-4-8',
  cwd: '/Users/x/dev/garlic',
  sessionId: 's1',
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  ...over,
});

describe('aggregate', () => {
  it('deduplicates records by id so a copied message counts once', () => {
    const r = rec({ id: 'msg_1', isMessage: true, input: 100, output: 50 });
    const snap = aggregate([r, { ...r }, { ...r }], new Date('2026-05-30T18:00:00Z'));
    expect(snap.totals.tokens).toBe(150); // not 450
    expect(snap.totals.messages).toBe(1);
    const opus = snap.byModel.find((m) => m.model === 'claude-opus-4-8');
    expect(opus?.input).toBe(100);
  });

  it('buckets cost by model, pricing only known models', () => {
    const snap = aggregate(
      [
        rec({ id: 'a', input: 1_000_000, model: 'claude-opus-4-8' }),
        rec({ id: 'b', input: 1_000_000, model: 'mystery-model' }),
      ],
      new Date('2026-05-30T18:00:00Z')
    );
    expect(snap.totals.cost).toBeCloseTo(5, 6); // only opus priced (input $5/1M); mystery costs $0
  });

  it('groups projects by cwd basename, sorted by cost', () => {
    const snap = aggregate(
      [
        rec({ id: 'a', input: 1_000_000, cwd: '/Users/x/dev/garlic' }),
        rec({ id: 'b', input: 100, cwd: '/Users/x/dev/f1-game' }),
      ],
      new Date('2026-05-30T18:00:00Z')
    );
    expect(snap.byProject[0].name).toBe('garlic');
    expect(snap.byProject.map((p) => p.name)).toContain('f1-game');
  });

  it('collapses git worktrees to their parent repo so one project does not fragment', () => {
    const snap = aggregate(
      [
        rec({
          id: 'a',
          sessionId: 's1',
          input: 100,
          cwd: '/Users/x/emdash/worktrees/emdash/task-a',
        }),
        rec({
          id: 'b',
          sessionId: 's2',
          input: 100,
          cwd: '/Users/x/emdash/worktrees/emdash/task-b',
        }),
        rec({ id: 'c', sessionId: 's3', input: 100, cwd: '/Users/x/dev/stagehand' }), // non-worktree
      ],
      new Date('2026-05-30T18:00:00Z')
    );
    const emdash = snap.byProject.find((p) => p.name === 'emdash');
    expect(emdash?.tokens).toBe(200); // task-a + task-b merged
    expect(emdash?.sessions).toBe(2); // both worktree sessions counted under emdash
    expect(snap.byProject.find((p) => p.name === 'stagehand')?.tokens).toBe(100);
    expect(snap.byProject.some((p) => p.name === 'task-a' || p.name === 'task-b')).toBe(false);
  });

  it('produces a 24-length byHour array', () => {
    const snap = aggregate([rec({ id: 'a', input: 10 })], new Date('2026-05-30T18:00:00Z'));
    expect(snap.byHour).toHaveLength(24);
  });

  it('tracks unpriced tokens and flags unpriced models instead of hiding them', () => {
    const snap = aggregate(
      [
        rec({ id: 'a', input: 1000, output: 500, vendor: 'anthropic', model: 'claude-opus-4-8' }),
        rec({ id: 'b', input: 200, output: 100, vendor: 'meta', model: 'llama-3' }),
      ],
      new Date('2026-05-30T18:00:00Z')
    );
    expect(snap.totals.unpricedTokens).toBe(300);
    expect(snap.byModel.find((m) => m.model === 'llama-3')?.priced).toBe(false);
    expect(snap.byModel.find((m) => m.model === 'claude-opus-4-8')?.priced).toBe(true);
  });

  it('rolls up cost by literal cwd without project collapse, post-dedup', () => {
    const a = rec({ id: 'a', input: 1_000_000, cwd: '/Users/x/emdash/worktrees/proj/task-1' });
    const snap = aggregate(
      [
        a,
        { ...a }, // duplicate id — must not double-count in byCwd
        rec({ id: 'b', input: 500_000, cwd: '/Users/x/emdash/worktrees/proj/task-2' }),
      ],
      new Date('2026-05-30T18:00:00Z')
    );
    const t1 = snap.byCwd.find((c) => c.cwd === '/Users/x/emdash/worktrees/proj/task-1');
    const t2 = snap.byCwd.find((c) => c.cwd === '/Users/x/emdash/worktrees/proj/task-2');
    expect(t1?.tokens).toBe(1_000_000); // deduped
    expect(t1?.cost).toBeCloseTo(5, 6); // opus input $5/1M
    expect(t2?.tokens).toBe(500_000);
    expect(snap.byCwd).toHaveLength(2); // two distinct cwds, NOT collapsed to one project
  });

  it('keeps windows.allTime equal to totals.cost even for records with no timestamp', () => {
    const snap = aggregate(
      [
        rec({ id: 'a', input: 1_000_000, model: 'claude-opus-4-8', ts: '' }), // unparseable ts
        rec({ id: 'b', input: 1_000_000, model: 'claude-opus-4-8' }),
      ],
      new Date('2026-05-30T18:00:00Z')
    );
    expect(snap.windows.allTime).toBeCloseTo(snap.totals.cost, 6); // no silent disagreement
    expect(snap.windows.allTime).toBeCloseTo(10, 6); // both opus input records counted
  });
});
