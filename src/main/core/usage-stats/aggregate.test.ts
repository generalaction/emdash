import { describe, expect, it } from 'vitest';
import { aggregate } from './aggregate';
import type { UsageRecord } from './types';

const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  id: 'x',
  isMessage: false,
  provider: 'claude',
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

  it('buckets cost by model and flags unpriced models', () => {
    const snap = aggregate(
      [
        rec({ id: 'a', input: 1_000_000, model: 'claude-opus-4-8' }),
        rec({ id: 'b', input: 1_000_000, model: 'mystery-model' }),
      ],
      new Date('2026-05-30T18:00:00Z')
    );
    expect(snap.totals.cost).toBeCloseTo(5, 6); // only opus priced (input $5/1M)
    expect(snap.unpricedModels).toContain('mystery-model');
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

  it('produces a 24-length byHour array', () => {
    const snap = aggregate([rec({ id: 'a', input: 10 })], new Date('2026-05-30T18:00:00Z'));
    expect(snap.byHour).toHaveLength(24);
  });
});
