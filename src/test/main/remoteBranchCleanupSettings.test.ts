import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/emdash-test',
  },
}));

import { normalizeSettings } from '../../main/settings';
import type { AppSettings } from '../../main/settings';

/** Minimal valid AppSettings skeleton for normalizeSettings. */
function makeSettings(overrides?: Partial<AppSettings>): AppSettings {
  return {
    repository: { branchPrefix: 'emdash', pushOnCreate: true },
    projectPrep: { autoInstallOnOpenInEditor: true },
    ...overrides,
  } as AppSettings;
}

describe('normalizeSettings – remoteBranchCleanup', () => {
  it('defaults to "never" when repository section is missing', () => {
    const result = normalizeSettings(makeSettings());
    expect(result.repository.remoteBranchCleanup).toBe('never');
  });

  it('defaults to "never" when remoteBranchCleanup is not set', () => {
    const result = normalizeSettings(
      makeSettings({ repository: { branchPrefix: 'test', pushOnCreate: false } } as any)
    );
    expect(result.repository.remoteBranchCleanup).toBe('never');
  });

  it.each(['ask', 'always', 'never', 'auto'] as const)('preserves valid mode "%s"', (mode) => {
    const result = normalizeSettings(
      makeSettings({
        repository: { branchPrefix: 'emdash', pushOnCreate: true, remoteBranchCleanup: mode },
      } as any)
    );
    expect(result.repository.remoteBranchCleanup).toBe(mode);
  });

  it('coerces invalid mode to "never"', () => {
    const result = normalizeSettings(
      makeSettings({
        repository: {
          branchPrefix: 'emdash',
          pushOnCreate: true,
          remoteBranchCleanup: 'bogus' as any,
        },
      } as any)
    );
    expect(result.repository.remoteBranchCleanup).toBe('never');
  });

  it('coerces numeric mode to "never"', () => {
    const result = normalizeSettings(
      makeSettings({
        repository: {
          branchPrefix: 'emdash',
          pushOnCreate: true,
          remoteBranchCleanup: 42 as any,
        },
      } as any)
    );
    expect(result.repository.remoteBranchCleanup).toBe('never');
  });
});

describe('normalizeSettings – remoteBranchCleanupDaysThreshold', () => {
  it('defaults to 7 when not set', () => {
    const result = normalizeSettings(makeSettings());
    expect(result.repository.remoteBranchCleanupDaysThreshold).toBe(7);
  });

  it('preserves valid threshold', () => {
    const result = normalizeSettings(
      makeSettings({
        repository: {
          branchPrefix: 'emdash',
          pushOnCreate: true,
          remoteBranchCleanupDaysThreshold: 30,
        },
      } as any)
    );
    expect(result.repository.remoteBranchCleanupDaysThreshold).toBe(30);
  });

  it('clamps threshold below minimum to 1', () => {
    const result = normalizeSettings(
      makeSettings({
        repository: {
          branchPrefix: 'emdash',
          pushOnCreate: true,
          remoteBranchCleanupDaysThreshold: 0,
        },
      } as any)
    );
    expect(result.repository.remoteBranchCleanupDaysThreshold).toBe(1);
  });

  it('clamps threshold above maximum to 365', () => {
    const result = normalizeSettings(
      makeSettings({
        repository: {
          branchPrefix: 'emdash',
          pushOnCreate: true,
          remoteBranchCleanupDaysThreshold: 999,
        },
      } as any)
    );
    expect(result.repository.remoteBranchCleanupDaysThreshold).toBe(365);
  });

  it('defaults non-numeric threshold to 7', () => {
    const result = normalizeSettings(
      makeSettings({
        repository: {
          branchPrefix: 'emdash',
          pushOnCreate: true,
          remoteBranchCleanupDaysThreshold: 'abc' as any,
        },
      } as any)
    );
    expect(result.repository.remoteBranchCleanupDaysThreshold).toBe(7);
  });
});
