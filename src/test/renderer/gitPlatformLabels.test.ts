import { describe, expect, it } from 'vitest';
import { getPlatformLabels } from '../../renderer/lib/gitPlatformLabels';

describe('getPlatformLabels', () => {
  it('returns PR labels for github', () => {
    const labels = getPlatformLabels('github');
    expect(labels.prNoun).toBe('PR');
    expect(labels.prNounFull).toBe('Pull Request');
    expect(labels.openSection).toBe('Open PRs');
    expect(labels.createAction).toBe('Create PR');
    expect(labels.mergeAction).toBe('Merge Pull Request');
    expect(labels.viewAction).toBe('View PR');
  });

  it('returns MR labels for gitlab', () => {
    const labels = getPlatformLabels('gitlab');
    expect(labels.prNoun).toBe('MR');
    expect(labels.prNounFull).toBe('Merge Request');
    expect(labels.openSection).toBe('Open MRs');
    expect(labels.createAction).toBe('Create MR');
    expect(labels.mergeAction).toBe('Merge MR');
    expect(labels.viewAction).toBe('View MR');
  });

  it('defaults to github when undefined', () => {
    const labels = getPlatformLabels(undefined);
    expect(labels.prNoun).toBe('PR');
  });
});
