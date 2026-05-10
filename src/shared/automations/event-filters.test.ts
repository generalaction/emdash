import { describe, expect, it } from 'vitest';
import { eventMatchesFilters } from './event-filters';
import type { AutomationEvent } from './events';

function issueEvent(): AutomationEvent {
  return {
    kind: 'issue.opened',
    projectId: 'project-1',
    occurredAt: 1,
    payload: {
      ref: '#1',
      title: 'Issue 1',
      url: 'https://github.com/acme/repo/issues/1',
      author: 'alice',
      number: '1',
      body: 'Body',
      labels: [],
      assignee: null,
    },
  };
}

describe('eventMatchesFilters', () => {
  it('does not match branch filters for events without a branch', () => {
    expect(eventMatchesFilters(issueEvent(), { branches: ['main'] })).toBe(false);
  });
});
