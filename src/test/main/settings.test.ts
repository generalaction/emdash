import { describe, expect, it, vi } from 'vitest';

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

describe('normalizeSettings – taskHoverAction', () => {
  it('preserves "archive"', () => {
    const result = normalizeSettings(makeSettings({ interface: { taskHoverAction: 'archive' } }));
    expect(result.interface?.taskHoverAction).toBe('archive');
  });

  it('preserves "delete"', () => {
    const result = normalizeSettings(makeSettings({ interface: { taskHoverAction: 'delete' } }));
    expect(result.interface?.taskHoverAction).toBe('delete');
  });

  it('coerces invalid value to "delete"', () => {
    const result = normalizeSettings(
      makeSettings({ interface: { taskHoverAction: 'invalid' as any } })
    );
    expect(result.interface?.taskHoverAction).toBe('delete');
  });

  it('defaults undefined to "delete"', () => {
    const result = normalizeSettings(makeSettings({ interface: {} }));
    expect(result.interface?.taskHoverAction).toBe('delete');
  });

  it('defaults missing interface to "delete"', () => {
    const result = normalizeSettings(makeSettings());
    expect(result.interface?.taskHoverAction).toBe('delete');
  });
});

describe('normalizeSettings – autoInferTaskNames', () => {
  it('defaults to true when tasks section is missing', () => {
    const result = normalizeSettings(makeSettings());
    expect(result.tasks?.autoInferTaskNames).toBe(true);
  });

  it('defaults to true when tasks section is empty', () => {
    const result = normalizeSettings(makeSettings({ tasks: {} as any }));
    expect(result.tasks?.autoInferTaskNames).toBe(true);
  });

  it('preserves true when explicitly set', () => {
    const result = normalizeSettings(makeSettings({ tasks: { autoInferTaskNames: true } as any }));
    expect(result.tasks?.autoInferTaskNames).toBe(true);
  });

  it('preserves false when explicitly set', () => {
    const result = normalizeSettings(makeSettings({ tasks: { autoInferTaskNames: false } as any }));
    expect(result.tasks?.autoInferTaskNames).toBe(false);
  });

  it('coerces truthy non-boolean to true', () => {
    const result = normalizeSettings(makeSettings({ tasks: { autoInferTaskNames: 1 } as any }));
    expect(result.tasks?.autoInferTaskNames).toBe(true);
  });

  it('coerces falsy non-boolean to false', () => {
    const result = normalizeSettings(makeSettings({ tasks: { autoInferTaskNames: 0 } as any }));
    expect(result.tasks?.autoInferTaskNames).toBe(false);
  });
});

describe('normalizeSettings - changelog dismissed versions', () => {
  it('normalizes, trims, and deduplicates versions', () => {
    const result = normalizeSettings(
      makeSettings({
        changelog: {
          dismissedVersions: [' v0.4.31 ', '0.4.31', 'v0.4.30'],
        },
      })
    );

    expect(result.changelog?.dismissedVersions).toEqual(['0.4.31', '0.4.30']);
  });

  it('defaults to an empty list when missing', () => {
    const result = normalizeSettings(makeSettings());
    expect(result.changelog?.dismissedVersions).toEqual([]);
  });
});

describe('normalizeSettings - notification sound profile', () => {
  it('defaults to the current sound profile when missing', () => {
    const result = normalizeSettings(makeSettings());
    expect(result.notifications?.soundProfile).toBe('default');
  });

  it('preserves the gilfoyle sound profile when selected', () => {
    const result = normalizeSettings(
      makeSettings({
        notifications: {
          enabled: true,
          sound: true,
          osNotifications: true,
          soundFocusMode: 'always',
          soundProfile: 'gilfoyle',
        },
      })
    );

    expect(result.notifications?.soundProfile).toBe('gilfoyle');
  });

  it('falls back to default for unknown sound profiles', () => {
    const result = normalizeSettings(
      makeSettings({
        notifications: {
          enabled: true,
          sound: true,
          osNotifications: true,
          soundFocusMode: 'always',
          soundProfile: 'unknown' as any,
        },
      })
    );

    expect(result.notifications?.soundProfile).toBe('default');
  });
});
