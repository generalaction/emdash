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
