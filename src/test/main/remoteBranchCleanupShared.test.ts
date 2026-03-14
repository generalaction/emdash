import { describe, it, expect } from 'vitest';
import {
  isValidRemoteBranchCleanupMode,
  clampCleanupDays,
  REMOTE_BRANCH_CLEANUP_MODES,
  DEFAULT_REMOTE_BRANCH_CLEANUP_MODE,
  DEFAULT_REMOTE_BRANCH_CLEANUP_DAYS,
  MIN_REMOTE_BRANCH_CLEANUP_DAYS,
  MAX_REMOTE_BRANCH_CLEANUP_DAYS,
} from '../../shared/remoteBranchCleanup';

describe('isValidRemoteBranchCleanupMode', () => {
  it.each(REMOTE_BRANCH_CLEANUP_MODES)('accepts valid mode "%s"', (mode) => {
    expect(isValidRemoteBranchCleanupMode(mode)).toBe(true);
  });

  it('rejects invalid string', () => {
    expect(isValidRemoteBranchCleanupMode('foo')).toBe(false);
  });

  it('rejects number', () => {
    expect(isValidRemoteBranchCleanupMode(42)).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidRemoteBranchCleanupMode(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidRemoteBranchCleanupMode(undefined)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidRemoteBranchCleanupMode('')).toBe(false);
  });
});

describe('clampCleanupDays', () => {
  it('returns default for undefined', () => {
    expect(clampCleanupDays(undefined)).toBe(DEFAULT_REMOTE_BRANCH_CLEANUP_DAYS);
  });

  it('returns default for NaN', () => {
    expect(clampCleanupDays(NaN)).toBe(DEFAULT_REMOTE_BRANCH_CLEANUP_DAYS);
  });

  it('returns default for Infinity', () => {
    expect(clampCleanupDays(Infinity)).toBe(DEFAULT_REMOTE_BRANCH_CLEANUP_DAYS);
  });

  it('returns default for non-number', () => {
    expect(clampCleanupDays('hello')).toBe(DEFAULT_REMOTE_BRANCH_CLEANUP_DAYS);
  });

  it('clamps below minimum to MIN', () => {
    expect(clampCleanupDays(0)).toBe(MIN_REMOTE_BRANCH_CLEANUP_DAYS);
    expect(clampCleanupDays(-10)).toBe(MIN_REMOTE_BRANCH_CLEANUP_DAYS);
  });

  it('clamps above maximum to MAX', () => {
    expect(clampCleanupDays(999)).toBe(MAX_REMOTE_BRANCH_CLEANUP_DAYS);
    expect(clampCleanupDays(1000)).toBe(MAX_REMOTE_BRANCH_CLEANUP_DAYS);
  });

  it('rounds fractional values', () => {
    expect(clampCleanupDays(7.3)).toBe(7);
    expect(clampCleanupDays(7.8)).toBe(8);
  });

  it('preserves valid integer within range', () => {
    expect(clampCleanupDays(1)).toBe(1);
    expect(clampCleanupDays(30)).toBe(30);
    expect(clampCleanupDays(365)).toBe(365);
  });
});

describe('constants', () => {
  it('DEFAULT_REMOTE_BRANCH_CLEANUP_MODE is "never"', () => {
    expect(DEFAULT_REMOTE_BRANCH_CLEANUP_MODE).toBe('never');
  });

  it('DEFAULT_REMOTE_BRANCH_CLEANUP_DAYS is 7', () => {
    expect(DEFAULT_REMOTE_BRANCH_CLEANUP_DAYS).toBe(7);
  });

  it('MIN is 1 and MAX is 365', () => {
    expect(MIN_REMOTE_BRANCH_CLEANUP_DAYS).toBe(1);
    expect(MAX_REMOTE_BRANCH_CLEANUP_DAYS).toBe(365);
  });
});
