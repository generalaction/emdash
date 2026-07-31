import { describe, expect, it } from 'vitest';
import { formatDuration } from './workspace-operations-panel';

describe('formatDuration', () => {
  it('collapses sub-second durations', () => {
    expect(formatDuration(0)).toBe('<1s');
    expect(formatDuration(999)).toBe('<1s');
  });

  it('clamps negative durations', () => {
    expect(formatDuration(-5_000)).toBe('<1s');
  });

  it('reports whole seconds under a minute', () => {
    expect(formatDuration(1_000)).toBe('1s');
    expect(formatDuration(1_999)).toBe('1s');
    expect(formatDuration(59_500)).toBe('59s');
  });

  it('reports minutes with leftover seconds', () => {
    expect(formatDuration(60_000)).toBe('1m');
    expect(formatDuration(75_000)).toBe('1m 15s');
    expect(formatDuration(600_000)).toBe('10m');
  });
});
