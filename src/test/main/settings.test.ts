import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/emdash-test',
  },
}));

import { normalizeSettings } from '../../main/settings';
import type { AppSettings } from '../../main/settings';
import { DEFAULT_REVIEW_AGENT, DEFAULT_REVIEW_PROMPT } from '../../shared/reviewPreset';

/** Minimal valid AppSettings skeleton for normalizeSettings. */
function makeSettings(overrides?: Partial<AppSettings>): AppSettings {
  return {
    repository: {
      branchPrefix: 'emdash',
      pushOnCreate: true,
      autoCloseLinkedIssuesOnPrCreate: true,
    },
    projectPrep: { autoInstallOnOpenInEditor: true },
    ...overrides,
  } as AppSettings;
}

describe('normalizeSettings - repository settings', () => {
  it('defaults autoCloseLinkedIssuesOnPrCreate to true', () => {
    const result = normalizeSettings(
      makeSettings({
        repository: {
          branchPrefix: 'emdash',
          pushOnCreate: true,
        } as any,
      })
    );

    expect(result.repository.autoCloseLinkedIssuesOnPrCreate).toBe(true);
  });

  it('preserves autoCloseLinkedIssuesOnPrCreate when explicitly disabled', () => {
    const result = normalizeSettings(
      makeSettings({
        repository: {
          branchPrefix: 'emdash',
          pushOnCreate: true,
          autoCloseLinkedIssuesOnPrCreate: false,
        },
      })
    );

    expect(result.repository.autoCloseLinkedIssuesOnPrCreate).toBe(false);
  });
});

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

describe('normalizeSettings – showResourceMonitor', () => {
  it('defaults to false when interface section is missing', () => {
    const result = normalizeSettings(makeSettings());
    expect(result.interface?.showResourceMonitor).toBe(false);
  });

  it('preserves false when explicitly set', () => {
    const result = normalizeSettings(makeSettings({ interface: { showResourceMonitor: false } }));
    expect(result.interface?.showResourceMonitor).toBe(false);
  });

  it('preserves true when explicitly set', () => {
    const result = normalizeSettings(makeSettings({ interface: { showResourceMonitor: true } }));
    expect(result.interface?.showResourceMonitor).toBe(true);
  });

  it('coerces missing value inside interface to false', () => {
    const result = normalizeSettings(makeSettings({ interface: {} }));
    expect(result.interface?.showResourceMonitor).toBe(false);
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

describe('normalizeSettings - keyboard shortcuts', () => {
  it('preserves explicitly removed shortcuts', () => {
    const result = normalizeSettings(
      makeSettings({
        keyboard: {
          toggleLeftSidebar: null,
        },
      })
    );

    expect(result.keyboard?.toggleLeftSidebar).toBeNull();
  });

  it('keeps defaults for missing shortcuts while persisting openInEditor overrides', () => {
    const result = normalizeSettings(
      makeSettings({
        keyboard: {
          openInEditor: { key: 'i', modifier: 'cmd' },
        },
      })
    );

    expect(result.keyboard?.commandPalette).toEqual({ key: 'k', modifier: 'cmd' });
    expect(result.keyboard?.openInEditor).toEqual({ key: 'i', modifier: 'cmd' });
  });
});

describe('normalizeSettings - review preset', () => {
  it('defaults to the shared review preset when missing', () => {
    const result = normalizeSettings(makeSettings());

    expect(result.review).toEqual({
      enabled: false,
      agent: DEFAULT_REVIEW_AGENT,
      prompt: DEFAULT_REVIEW_PROMPT,
    });
  });

  it('preserves valid configured values', () => {
    const result = normalizeSettings(
      makeSettings({
        review: {
          enabled: true,
          agent: 'codex',
          prompt: 'Review the diff for correctness only.',
        },
      })
    );

    expect(result.review).toEqual({
      enabled: true,
      agent: 'codex',
      prompt: 'Review the diff for correctness only.',
    });
  });

  it('falls back when the configured agent or prompt is invalid', () => {
    const result = normalizeSettings(
      makeSettings({
        review: {
          enabled: true,
          agent: 'not-real' as any,
          prompt: '   ',
        },
      })
    );

    expect(result.review).toEqual({
      enabled: true,
      agent: DEFAULT_REVIEW_AGENT,
      prompt: DEFAULT_REVIEW_PROMPT,
    });
  });
});

describe('normalizeSettings – terminal settings', () => {
  it('preserves macOptionIsMeta: true', () => {
    const result = normalizeSettings(
      makeSettings({
        terminal: {
          fontFamily: '',
          fontSize: 0,
          autoCopyOnSelection: false,
          macOptionIsMeta: true,
        },
      })
    );
    expect(result.terminal?.macOptionIsMeta).toBe(true);
  });
});

describe('normalizeSettings – expandCommitDetail', () => {
  it('defaults expandCommitDetail to false when not set', () => {
    const result = normalizeSettings(makeSettings());
    expect(result.interface?.expandCommitDetail).toBe(false);
  });

  it('preserves expandCommitDetail: true', () => {
    const result = normalizeSettings(makeSettings({ interface: { expandCommitDetail: true } }));
    expect(result.interface?.expandCommitDetail).toBe(true);
  });

  it('preserves expandCommitDetail: false', () => {
    const result = normalizeSettings(makeSettings({ interface: { expandCommitDetail: false } }));
    expect(result.interface?.expandCommitDetail).toBe(false);
  });
});
