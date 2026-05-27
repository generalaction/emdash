import { describe, expect, it } from 'vitest';
import { normalizeDownloadProgress } from './update-progress';

describe('normalizeDownloadProgress', () => {
  it('derives percent from bytes when updater percent is zero', () => {
    expect(
      normalizeDownloadProgress({
        bytesPerSecond: 100,
        percent: 0,
        transferred: 25,
        total: 100,
      }).percent
    ).toBe(25);
  });

  it('keeps a positive updater percent', () => {
    expect(
      normalizeDownloadProgress({
        percent: 12,
        transferred: 25,
        total: 100,
      }).percent
    ).toBe(12);
  });

  it('clamps derived percent to the progress range', () => {
    expect(normalizeDownloadProgress({ percent: 0, transferred: 120, total: 100 }).percent).toBe(
      100
    );
  });
});
