import { describe, expect, it } from 'vitest';
import { pickCompactedDisplay } from './compacted-path-label';

const measureByLength = (text: string) => text.length;

describe('pickCompactedDisplay', () => {
  it('returns the joined path when every segment fits', () => {
    expect(
      pickCompactedDisplay(['dossier1', 'dossier2', 'dossier3', 'dossier4'], 35, measureByLength)
    ).toBe('dossier1/dossier2/dossier3/dossier4');
  });

  it('drops the innermost middle segment first', () => {
    expect(
      pickCompactedDisplay(['dossier1', 'dossier2', 'dossier3', 'dossier4'], 30, measureByLength)
    ).toBe('dossier1/dossier2/.../dossier4');
  });

  it('partially truncates the next-to-last front segment', () => {
    expect(
      pickCompactedDisplay(['dossier1', 'dossier2', 'dossier3', 'dossier4'], 24, measureByLength)
    ).toBe('dossier1/dos.../dossier4');
  });

  it('fully drops the next-to-last front segment when partials no longer fit', () => {
    expect(
      pickCompactedDisplay(['dossier1', 'dossier2', 'dossier3', 'dossier4'], 21, measureByLength)
    ).toBe('dossier1/.../dossier4');
  });

  it('partially truncates the first segment before dropping it', () => {
    expect(
      pickCompactedDisplay(['dossier1', 'dossier2', 'dossier3', 'dossier4'], 15, measureByLength)
    ).toBe('dos.../dossier4');
  });

  it('drops every front segment when only `.../last` fits', () => {
    expect(
      pickCompactedDisplay(['dossier1', 'dossier2', 'dossier3', 'dossier4'], 12, measureByLength)
    ).toBe('.../dossier4');
  });

  it('returns the last segment unprefixed when even `.../last` overflows', () => {
    expect(
      pickCompactedDisplay(['dossier1', 'dossier2', 'dossier3', 'dossier4'], 11, measureByLength)
    ).toBe('dossier4');
  });

  it('truncates the last segment itself as a final fallback', () => {
    expect(
      pickCompactedDisplay(['dossier1', 'dossier2', 'dossier3', 'dossier4'], 7, measureByLength)
    ).toBe('doss...');
  });

  it('handles a 3-segment chain by dropping the middle segment', () => {
    expect(pickCompactedDisplay(['src', 'lib', 'core'], 12, measureByLength)).toBe('src/lib/core');
    expect(pickCompactedDisplay(['src', 'lib', 'core'], 11, measureByLength)).toBe('sr.../core');
  });

  it('handles a 2-segment chain by skipping the inner partial-truncate', () => {
    expect(pickCompactedDisplay(['alpha', 'beta'], 10, measureByLength)).toBe('alpha/beta');
    expect(pickCompactedDisplay(['alpha', 'beta'], 8, measureByLength)).toBe('.../beta');
  });

  it('returns the only segment unmodified when it fits', () => {
    expect(pickCompactedDisplay(['solo'], 10, measureByLength)).toBe('solo');
  });

  it('returns an empty string for an empty input', () => {
    expect(pickCompactedDisplay([], 10, measureByLength)).toBe('');
  });
});
