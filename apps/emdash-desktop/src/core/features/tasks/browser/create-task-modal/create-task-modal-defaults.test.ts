import { describe, expect, it } from 'vitest';
import { createTaskModalDefaults } from './create-task-modal-defaults';

describe('Create Task entry points', () => {
  it('opens branch settings without preselecting an issue, including when issues are connected', () => {
    expect(
      createTaskModalDefaults('from-branch', { hasIssues: true, hasPullRequests: true })
    ).toEqual({
      linkedType: null,
      tab: 'workspace',
    });
    expect(
      createTaskModalDefaults('from-branch', { hasIssues: true, hasPullRequests: false })
    ).toEqual({ linkedType: null, tab: 'workspace' });
  });

  it('preserves issue and pull request entry points', () => {
    const availability = { hasIssues: true, hasPullRequests: true };
    expect(createTaskModalDefaults('from-issue', availability)).toEqual({
      linkedType: 'issue',
      tab: 'conversation',
    });
    expect(createTaskModalDefaults('from-pull-request', availability)).toEqual({
      linkedType: 'pr',
      tab: 'conversation',
    });
  });

  it('preserves the general Create Task default', () => {
    expect(createTaskModalDefaults(undefined, { hasIssues: true, hasPullRequests: true })).toEqual({
      linkedType: 'issue',
      tab: 'conversation',
    });
    expect(createTaskModalDefaults(undefined, { hasIssues: false, hasPullRequests: true })).toEqual(
      { linkedType: 'pr', tab: 'conversation' }
    );
    expect(
      createTaskModalDefaults(undefined, { hasIssues: false, hasPullRequests: false })
    ).toEqual({ linkedType: null, tab: 'conversation' });
  });
});
