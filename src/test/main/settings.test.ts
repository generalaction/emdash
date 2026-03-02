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
