import { describe, expect, it } from 'vitest';
import {
  linkedIssue,
  linkedIssueDisplayIdentifier,
  linkedIssueMentionName,
  linkedIssueResourcesMatch,
} from './linked-issue';

describe('linked issue source persistence', () => {
  const legacy = {
    provider: 'linear',
    identifier: 'ENG-1',
    title: 'Issue',
    url: 'https://linear.app/a/issue/ENG-1',
  };
  it('reads old snapshots without inventing a source account', () => {
    expect(linkedIssue.parseJson(JSON.stringify(legacy))).toEqual(legacy);
  });
  it('round-trips the account that supplied an issue', () => {
    const current = linkedIssue.schema.parse({ ...legacy, accountId: 'workspace-a' });
    expect(linkedIssue.parseJson(linkedIssue.serialize(current))).toEqual(current);
  });
  it.each([
    ['trello', 'https://trello.com/c/abc123/1-old-name', 'https://trello.com/c/abc123/1-new-name'],
    [
      'linear',
      'https://linear.app/acme/issue/ENG-1/old-title',
      'https://linear.app/acme/issue/ENG-1/new-title',
    ],
    [
      'notion',
      'https://www.notion.so/Old-title-37818d1ba831812e8ca0c115c72de662',
      'https://www.notion.so/New-title-37818d1ba831812e8ca0c115c72de662',
    ],
  ] as const)('retains %s resource identity across title changes', (provider, before, after) => {
    expect(linkedIssueResourcesMatch(provider, before, after)).toBe(true);
  });
  it.each([
    ['trello', 'https://trello.com/c/abc123/name', 'https://trello.com/c/xyz456/name'],
    [
      'linear',
      'https://linear.app/acme/issue/ENG-1/name',
      'https://linear.app/other/issue/ENG-1/name',
    ],
    ['gitlab', 'https://gitlab.com/acme/a/-/issues/1', 'https://gitlab.com/acme/b/-/issues/1'],
    ['forgejo', 'https://forgejo.example/a/b/issues/1', 'https://other.example/a/b/issues/1'],
  ] as const)('rejects a different %s resource or scope', (provider, before, after) => {
    expect(linkedIssueResourcesMatch(provider, before, after)).toBe(false);
  });
  it('keeps workspace identity while ignoring fragments and trailing slashes', () => {
    expect(linkedIssueResourcesMatch('linear', legacy.url, `${legacy.url}/#comment`)).toBe(true);
    expect(
      linkedIssueResourcesMatch('linear', legacy.url, 'https://linear.app/b/issue/ENG-1')
    ).toBe(false);
    expect(linkedIssueResourcesMatch('linear', '', '')).toBe(false);
  });
});

describe('linked issue display helpers', () => {
  it('uses displayIdentifier for issue mentions when available', () => {
    expect(
      linkedIssueMentionName({
        identifier: 'internal-id',
        displayIdentifier: 'ENG-123',
        title: 'Fix issue mentions',
      })
    ).toBe('ENG-123');
  });

  it('uses title for issue mentions when the provider hides internal identifiers', () => {
    expect(
      linkedIssueMentionName({
        identifier: '37818d1b-a831-812e-8ca0-c115c72de662',
        displayIdentifier: null,
        title: 'ai health paper website',
      })
    ).toBe('ai health paper website');
  });

  it('keeps raw identifiers visible only when displayIdentifier is unspecified', () => {
    const issue = { identifier: '#42', title: 'Fix login' };

    expect(linkedIssueDisplayIdentifier(issue)).toBe('#42');
    expect(linkedIssueMentionName(issue)).toBe('#42');
  });

  it('uses a generic mention name when both display identifier and title are hidden', () => {
    expect(
      linkedIssueMentionName({
        identifier: 'internal-id',
        displayIdentifier: null,
        title: '',
      })
    ).toBe('Linked issue');
  });
});
