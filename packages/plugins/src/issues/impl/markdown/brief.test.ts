import { describe, expect, it } from 'vitest';
import {
  deriveCapability,
  hasHoldout,
  mapStatus,
  parseBriefIdentity,
  parseFrontmatter,
  parseTitle,
  toIssueData,
} from './brief';

const PATTERN = 'docs/capabilities/*/*/tasks/WO-*.md';
const PATH = 'docs/capabilities/platform/connectors/tasks/WO-1811-the-backend-context-retries.md';

function brief(body: string, overrides: { path?: string } = {}) {
  return {
    path: overrides.path ?? PATH,
    repositoryPath: '/home/dev/fridayos',
    text: body,
    updatedAt: '2026-09-15T09:00:00Z',
  };
}

describe('parseBriefIdentity', () => {
  it('splits the id token from the slug', () => {
    expect(parseBriefIdentity(PATH)).toEqual({
      id: 'WO-1811',
      slug: 'the-backend-context-retries',
    });
  });

  it('handles an id with no slug', () => {
    expect(parseBriefIdentity('tasks/WO-7.md')).toEqual({ id: 'WO-7', slug: '' });
  });

  it('falls back to the file stem when there is no id token', () => {
    expect(parseBriefIdentity('tasks/roadmap.md')).toEqual({ id: 'roadmap', slug: 'roadmap' });
  });
});

describe('deriveCapability', () => {
  it('reads the segments the directory wildcards matched', () => {
    expect(deriveCapability(PATTERN, PATH)).toBe('platform/connectors');
  });

  it('has no capability for a pattern with no directory wildcard', () => {
    expect(deriveCapability('tasks/WO-*.md', 'tasks/WO-1.md')).toBeUndefined();
  });

  it('has no capability for a `**` pattern, which has no positional alignment', () => {
    expect(deriveCapability('docs/**/WO-*.md', 'docs/a/b/WO-1.md')).toBeUndefined();
  });

  it('has no capability when the path depth does not match the pattern', () => {
    expect(deriveCapability(PATTERN, 'docs/capabilities/platform/tasks/WO-1.md')).toBeUndefined();
  });
});

describe('parseFrontmatter', () => {
  it('reads scalar fields and strips the block from the body', () => {
    const parsed = parseFrontmatter('---\nid: WO-1811\nstatus: ready\n---\n\n# WO-1811: Title\n');
    expect(parsed.fields).toEqual({ id: 'WO-1811', status: 'ready' });
    expect(parsed.body).toBe('\n# WO-1811: Title\n');
  });

  it('leaves a document without frontmatter untouched', () => {
    expect(parseFrontmatter('# Title\n').body).toBe('# Title\n');
  });

  it('skips list and nested values rather than mis-parsing them', () => {
    const parsed = parseFrontmatter('---\nstatus: ready\nrelates-to: [A, B]\n---\nbody\n');
    expect(parsed.fields.status).toBe('ready');
    expect(parsed.fields['relates-to']).toBe('[A, B]');
  });
});

describe('parseTitle', () => {
  it('strips the leading id and its colon', () => {
    expect(parseTitle('# WO-1811: The backend context retries', 'WO-1811')).toBe(
      'The backend context retries'
    );
  });

  it('strips a leading id with no colon', () => {
    expect(parseTitle('# WO-1811 The backend context retries', 'WO-1811')).toBe(
      'The backend context retries'
    );
  });

  it('strips a leading id followed by a dash', () => {
    expect(parseTitle('# WO-1811 - Retries', 'WO-1811')).toBe('Retries');
  });

  it('keeps a title that does not start with the id', () => {
    expect(parseTitle('# Retries after an outage', 'WO-1811')).toBe('Retries after an outage');
  });

  it('uses the first H1 and ignores deeper headings', () => {
    expect(parseTitle('## Second\n\n# First\n\n# Later', 'WO-1')).toBe('First');
  });

  it('returns undefined when there is no H1', () => {
    expect(parseTitle('## Only an H2\n', 'WO-1')).toBeUndefined();
  });
});

describe('mapStatus', () => {
  it.each([
    ['ready', 'todo'],
    ['in_progress', 'in_progress'],
    ['in_review', 'review'],
    ['blocked', 'triage'],
    ['done', 'done'],
  ])('maps %s to %s', (input, expected) => {
    expect(mapStatus(input)).toBe(expected);
  });

  it('is case and whitespace insensitive', () => {
    expect(mapStatus('  In_Review ')).toBe('review');
  });

  it('passes an unknown vocabulary through untouched', () => {
    expect(mapStatus('parked')).toBe('parked');
  });

  it('is undefined when the file declares no status', () => {
    expect(mapStatus(undefined)).toBeUndefined();
    expect(mapStatus('   ')).toBeUndefined();
  });
});

describe('hasHoldout', () => {
  it('reads a frontmatter flag', () => {
    expect(hasHoldout(parseFrontmatter('---\nholdout: true\n---\nbody\n'))).toBe(true);
  });

  it('reads a truthy cell under a holdout column', () => {
    const text = [
      '| target | kind | holdout |',
      '| --- | --- | --- |',
      '| AC-1 | deterministic | false |',
      '| AC-2 | deterministic | true |',
    ].join('\n');
    expect(hasHoldout(parseFrontmatter(text))).toBe(true);
  });

  it('ignores a holdout column whose cells are all false', () => {
    const text = ['| target | holdout |', '| --- | --- |', '| AC-1 | false |'].join('\n');
    expect(hasHoldout(parseFrontmatter(text))).toBe(false);
  });

  it('ignores the word holdout in prose', () => {
    const text = 'Checks you do not run: no agent walk or holdout covers its anchors.';
    expect(hasHoldout(parseFrontmatter(text))).toBe(false);
  });
});

describe('toIssueData', () => {
  const text = [
    '---',
    'id: WO-1811',
    'status: in_review',
    '---',
    '',
    '# WO-1811: The backend context retries after an outage',
    '',
    'The desktop boots while core-api is unreachable.',
    '',
    '| target | kind | holdout |',
    '| --- | --- | --- |',
    '| AC-CONN-18 | deterministic | true |',
  ].join('\n');

  it('maps a brief to the canonical issue shape', () => {
    expect(toIssueData(brief(text), PATTERN)).toEqual({
      identifier: 'WO-1811',
      title: 'The backend context retries after an outage',
      url: `file:///home/dev/fridayos/${PATH}`,
      description: expect.stringContaining('The desktop boots while core-api is unreachable.'),
      branchName: 'feature/wo-1811-the-backend-context-retries',
      status: 'review',
      labels: ['platform/connectors', 'holdout'],
      project: 'platform/connectors',
      updatedAt: '2026-09-15T09:00:00Z',
    });
  });

  it('omits the frontmatter from the description', () => {
    expect(toIssueData(brief(text), PATTERN).description).not.toContain('id: WO-1811');
  });

  it('falls back to the slug when the file has no H1', () => {
    expect(toIssueData(brief('---\nstatus: ready\n---\nno heading\n'), PATTERN).title).toBe(
      'the-backend-context-retries'
    );
  });

  it('carries no labels when the file names no capability and no holdout', () => {
    const issue = toIssueData(brief('# Title\n', { path: 'tasks/WO-2-x.md' }), 'tasks/WO-*.md');
    expect(issue.labels).toBeUndefined();
    expect(issue.project).toBeUndefined();
  });

  it('percent-encodes a path with spaces in the file url', () => {
    const issue = toIssueData(
      { path: 'tasks/WO-3-a b.md', repositoryPath: '/home/dev/repo', text: '# T\n' },
      'tasks/WO-*.md'
    );
    expect(issue.url).toBe('file:///home/dev/repo/tasks/WO-3-a%20b.md');
  });
});
