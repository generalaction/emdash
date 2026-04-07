import { describe, expect, it } from 'vitest';
import {
  getPlatformConfig,
  buildCreateCommand,
  buildStatusCommand,
  buildStatusListFallbackCommand,
  buildMergeCommand,
  buildAutoMergeCommand,
  buildDisableAutoMergeCommand,
  buildListCommand,
  parseStatusResponse,
  parseListResponse,
  isPrAlreadyExistsError,
  isCliNotInstalledError,
  isPrNotFoundError,
  extractUrlFromOutput,
} from '../../main/services/GitPlatformService';

// ---------------------------------------------------------------------------
// getPlatformConfig
// ---------------------------------------------------------------------------
describe('getPlatformConfig', () => {
  it('returns github config', () => {
    const cfg = getPlatformConfig('github');
    expect(cfg.cli).toBe('gh');
    expect(cfg.noun).toBe('pr');
    expect(cfg.nounFull).toBe('pull request');
  });

  it('returns gitlab config', () => {
    const cfg = getPlatformConfig('gitlab');
    expect(cfg.cli).toBe('glab');
    expect(cfg.noun).toBe('mr');
    expect(cfg.nounFull).toBe('merge request');
  });
});

// ---------------------------------------------------------------------------
// buildCreateCommand
// ---------------------------------------------------------------------------
describe('buildCreateCommand', () => {
  describe('github', () => {
    it('builds a basic create command', () => {
      const cmd = buildCreateCommand('github', {
        title: 'My PR',
        base: 'main',
        head: 'feature-branch',
      });
      expect(cmd).toContain('gh pr create');
      expect(cmd).toContain('--title');
      expect(cmd).toContain('My PR');
      expect(cmd).toContain('--base');
      expect(cmd).toContain('main');
      expect(cmd).toContain('--head');
      expect(cmd).toContain('feature-branch');
    });

    it('includes --draft when draft is true', () => {
      const cmd = buildCreateCommand('github', {
        title: 'Draft PR',
        base: 'main',
        draft: true,
      });
      expect(cmd).toContain('--draft');
    });

    it('includes --web when web is true', () => {
      const cmd = buildCreateCommand('github', {
        title: 'Web PR',
        base: 'main',
        web: true,
      });
      expect(cmd).toContain('--web');
    });

    it('includes --fill when fill is true', () => {
      const cmd = buildCreateCommand('github', {
        title: 'Fill PR',
        base: 'main',
        fill: true,
      });
      expect(cmd).toContain('--fill');
    });

    it('uses --body for inline body text', () => {
      const cmd = buildCreateCommand('github', {
        title: 'Body PR',
        base: 'main',
        body: 'PR description here',
      });
      expect(cmd).toContain('--body');
      expect(cmd).toContain('PR description here');
    });

    it('uses --body-file for body file', () => {
      const cmd = buildCreateCommand('github', {
        title: 'File PR',
        base: 'main',
        bodyFile: '/tmp/body.txt',
      });
      expect(cmd).toContain('--body-file');
      expect(cmd).toContain('/tmp/body.txt');
    });
  });

  describe('gitlab', () => {
    it('builds a basic create command with --target-branch and --source-branch', () => {
      const cmd = buildCreateCommand('gitlab', {
        title: 'My MR',
        base: 'main',
        head: 'feature-branch',
      });
      expect(cmd).toContain('glab mr create');
      expect(cmd).toContain('--title');
      expect(cmd).toContain('My MR');
      expect(cmd).toContain('--target-branch');
      expect(cmd).toContain('main');
      expect(cmd).toContain('--source-branch');
      expect(cmd).toContain('feature-branch');
    });

    it('includes --draft when draft is true', () => {
      const cmd = buildCreateCommand('gitlab', {
        title: 'Draft MR',
        base: 'main',
        draft: true,
      });
      expect(cmd).toContain('--draft');
    });

    it('includes --web when web is true', () => {
      const cmd = buildCreateCommand('gitlab', {
        title: 'Web MR',
        base: 'main',
        web: true,
      });
      expect(cmd).toContain('--web');
    });

    it('includes --fill when fill is true', () => {
      const cmd = buildCreateCommand('gitlab', {
        title: 'Fill MR',
        base: 'main',
        fill: true,
      });
      expect(cmd).toContain('--fill');
    });

    it('uses --description for inline body text', () => {
      const cmd = buildCreateCommand('gitlab', {
        title: 'Desc MR',
        base: 'main',
        body: 'MR description here',
      });
      expect(cmd).toContain('--description');
      expect(cmd).toContain('MR description here');
      // Should NOT use --body (that is GitHub syntax)
      expect(cmd).not.toMatch(/--body[^-]/);
    });

    it('uses command substitution for body file (glab has no @file syntax)', () => {
      const cmd = buildCreateCommand('gitlab', {
        title: 'File MR',
        base: 'main',
        bodyFile: '/tmp/body.txt',
      });
      expect(cmd).toContain(`--description "$(cat '/tmp/body.txt')"`);
      expect(cmd).not.toContain('@/tmp');
    });

    it('includes --yes for non-interactive', () => {
      const cmd = buildCreateCommand('gitlab', {
        title: 'MR',
        base: 'main',
      });
      expect(cmd).toContain('--yes');
    });
  });
});

// ---------------------------------------------------------------------------
// buildStatusCommand
// ---------------------------------------------------------------------------
describe('buildStatusCommand', () => {
  describe('github', () => {
    it('builds a gh pr view command with JSON fields', () => {
      const cmd = buildStatusCommand('github');
      expect(cmd).toContain('gh pr view');
      expect(cmd).toContain('--json');
      expect(cmd).toContain('-q .');
      expect(cmd).toContain('number');
      expect(cmd).toContain('url');
      expect(cmd).toContain('state');
      expect(cmd).toContain('autoMergeRequest');
    });

    it('includes PR number when provided', () => {
      const cmd = buildStatusCommand('github', 42);
      expect(cmd).toContain('gh pr view 42');
    });
  });

  describe('gitlab', () => {
    it('returns null when no MR number (caller uses fallback)', () => {
      const cmd = buildStatusCommand('gitlab');
      expect(cmd).toBeNull();
    });

    it('uses glab api with MR number when provided', () => {
      const cmd = buildStatusCommand('gitlab', 99);
      expect(cmd).toContain('glab api');
      expect(cmd).toContain('projects/:id/merge_requests/99');
    });
  });
});

// ---------------------------------------------------------------------------
// buildStatusListFallbackCommand
// ---------------------------------------------------------------------------
describe('buildStatusListFallbackCommand', () => {
  it('github: builds gh pr list --head with JSON fields and all states', () => {
    const cmd = buildStatusListFallbackCommand('github', 'my-branch');
    expect(cmd).toContain('gh pr list');
    expect(cmd).toContain('--head');
    expect(cmd).toContain('my-branch');
    expect(cmd).toContain('--state all');
    expect(cmd).toContain('--json');
    expect(cmd).toContain('--limit 1');
  });

  it('gitlab: builds glab api with source_branch param and all states', () => {
    const cmd = buildStatusListFallbackCommand('gitlab', 'my-branch');
    expect(cmd).toContain('glab api');
    expect(cmd).toContain('projects/:id/merge_requests');
    expect(cmd).toContain('scope=all');
    expect(cmd).toContain('state=all');
    expect(cmd).toContain('source_branch=my-branch');
    expect(cmd).toContain('order_by=updated_at');
    expect(cmd).toContain('sort=desc');
    expect(cmd).toContain('per_page=1');
  });
});

// ---------------------------------------------------------------------------
// buildMergeCommand
// ---------------------------------------------------------------------------
describe('buildMergeCommand', () => {
  describe('github', () => {
    it('builds a basic merge command with default strategy', () => {
      const cmd = buildMergeCommand('github', {});
      expect(cmd).toContain('gh pr merge');
      expect(cmd).toContain('--merge');
    });

    it('includes PR number when provided', () => {
      const cmd = buildMergeCommand('github', { prNumber: 10 });
      expect(cmd).toContain('gh pr merge 10');
    });

    it('uses squash strategy', () => {
      const cmd = buildMergeCommand('github', { strategy: 'squash' });
      expect(cmd).toContain('--squash');
    });

    it('uses rebase strategy', () => {
      const cmd = buildMergeCommand('github', { strategy: 'rebase' });
      expect(cmd).toContain('--rebase');
    });

    it('includes --admin when admin is true', () => {
      const cmd = buildMergeCommand('github', { admin: true });
      expect(cmd).toContain('--admin');
    });
  });

  describe('gitlab', () => {
    it('builds a basic merge command without --merge and with --yes', () => {
      const cmd = buildMergeCommand('gitlab', {});
      expect(cmd).toContain('glab mr merge');
      expect(cmd).not.toContain('--merge');
      expect(cmd).toContain('--yes');
    });

    it('includes MR number when provided', () => {
      const cmd = buildMergeCommand('gitlab', { prNumber: 20 });
      expect(cmd).toContain('glab mr merge 20');
    });

    it('uses squash strategy', () => {
      const cmd = buildMergeCommand('gitlab', { strategy: 'squash' });
      expect(cmd).toContain('--squash');
    });

    it('uses rebase strategy', () => {
      const cmd = buildMergeCommand('gitlab', { strategy: 'rebase' });
      expect(cmd).toContain('--rebase');
    });

    it('does NOT include --admin for gitlab', () => {
      const cmd = buildMergeCommand('gitlab', { admin: true });
      expect(cmd).not.toContain('--admin');
    });
  });
});

// ---------------------------------------------------------------------------
// buildAutoMergeCommand
// ---------------------------------------------------------------------------
describe('buildAutoMergeCommand', () => {
  it('github: uses --auto flag', () => {
    const cmd = buildAutoMergeCommand('github', { prNumber: 5, strategy: 'squash' });
    expect(cmd).toContain('gh pr merge 5');
    expect(cmd).toContain('--auto');
    expect(cmd).toContain('--squash');
  });

  it('github: defaults to --merge strategy', () => {
    const cmd = buildAutoMergeCommand('github', {});
    expect(cmd).toContain('--auto');
    expect(cmd).toContain('--merge');
  });

  it('gitlab: uses --auto-merge and --yes', () => {
    const cmd = buildAutoMergeCommand('gitlab', { prNumber: 8, strategy: 'squash' });
    expect(cmd).toContain('glab mr merge 8');
    expect(cmd).toContain('--auto-merge');
    expect(cmd).toContain('--squash');
    expect(cmd).toContain('--yes');
  });

  it('gitlab: does not emit --merge for default auto-merge strategy', () => {
    const cmd = buildAutoMergeCommand('gitlab', {});
    expect(cmd).toContain('--auto-merge');
    expect(cmd).not.toContain('--merge');
  });
});

// ---------------------------------------------------------------------------
// buildDisableAutoMergeCommand
// ---------------------------------------------------------------------------
describe('buildDisableAutoMergeCommand', () => {
  it('github: returns a gh pr merge --disable-auto command', () => {
    const cmd = buildDisableAutoMergeCommand('github', 5);
    expect(cmd).not.toBeNull();
    expect(cmd).toContain('gh pr merge 5');
    expect(cmd).toContain('--disable-auto');
  });

  it('github: works without PR number', () => {
    const cmd = buildDisableAutoMergeCommand('github');
    expect(cmd).not.toBeNull();
    expect(cmd).toContain('gh pr merge');
    expect(cmd).toContain('--disable-auto');
  });

  it('gitlab: returns null (not supported)', () => {
    const cmd = buildDisableAutoMergeCommand('gitlab');
    expect(cmd).toBeNull();
  });

  it('gitlab: returns null even with PR number', () => {
    const cmd = buildDisableAutoMergeCommand('gitlab', 10);
    expect(cmd).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildListCommand
// ---------------------------------------------------------------------------
describe('buildListCommand', () => {
  describe('github', () => {
    it('builds gh pr list command with --json and --limit', () => {
      const cmd = buildListCommand('github', { limit: 25 });
      expect(cmd).toContain('gh pr list');
      expect(cmd).toContain('--state open');
      expect(cmd).toContain('--json');
      expect(cmd).toContain('--limit 25');
    });

    it('includes --search when searchQuery is provided', () => {
      const cmd = buildListCommand('github', { limit: 10, searchQuery: 'bugfix' });
      expect(cmd).toContain('--search');
      expect(cmd).toContain('bugfix');
    });
  });

  describe('gitlab', () => {
    it('builds glab api command with scope=all, state=opened, and per_page', () => {
      const cmd = buildListCommand('gitlab', { limit: 25 });
      expect(cmd).toContain('glab api');
      expect(cmd).toContain('projects/:id/merge_requests');
      expect(cmd).toContain('scope=all');
      expect(cmd).toContain('state=opened');
      expect(cmd).toContain('order_by=updated_at');
      expect(cmd).toContain('sort=desc');
      expect(cmd).toContain('per_page=25');
    });

    it('includes search param when searchQuery is free text', () => {
      const cmd = buildListCommand('gitlab', { limit: 10, searchQuery: 'bugfix' });
      expect(cmd).toContain('search=bugfix');
    });

    it('parses assignee:@me into assigned_to_me scope for gitlab', () => {
      const cmd = buildListCommand('gitlab', { limit: 10, searchQuery: 'assignee:@me' });
      expect(cmd).toContain('scope=assigned_to_me');
      expect(cmd).not.toContain('search=');
    });

    it('parses reviewer:@me into reviews_for_me scope for gitlab', () => {
      const cmd = buildListCommand('gitlab', { limit: 10, searchQuery: 'reviewer:@me' });
      expect(cmd).toContain('scope=reviews_for_me');
    });

    it('parses draft:true into wip=yes param for gitlab', () => {
      const cmd = buildListCommand('gitlab', { limit: 10, searchQuery: 'draft:true' });
      expect(cmd).toContain('wip=yes');
    });

    it('parses not-draft into wip=no param for gitlab', () => {
      const cmd = buildListCommand('gitlab', { limit: 10, searchQuery: 'reviewer:@me not-draft' });
      expect(cmd).toContain('scope=reviews_for_me');
      expect(cmd).toContain('wip=no');
      expect(cmd).not.toContain('search=');
    });

    it('passes free text to search param for gitlab', () => {
      const cmd = buildListCommand('gitlab', { limit: 10, searchQuery: 'fix login bug' });
      expect(cmd).toContain('search=fix%20login%20bug');
    });
  });
});

// ---------------------------------------------------------------------------
// parseStatusResponse
// ---------------------------------------------------------------------------
describe('parseStatusResponse', () => {
  describe('github', () => {
    it('parses a realistic gh pr view JSON response', () => {
      const raw = JSON.stringify({
        number: 123,
        url: 'https://github.com/owner/repo/pull/123',
        state: 'OPEN',
        isDraft: false,
        mergeStateStatus: 'CLEAN',
        headRefName: 'feature-branch',
        baseRefName: 'main',
        title: 'Add feature',
        author: { login: 'octocat' },
        additions: 10,
        deletions: 5,
        changedFiles: 3,
        autoMergeRequest: null,
        updatedAt: '2025-01-15T10:00:00Z',
      });
      const result = parseStatusResponse('github', raw);
      expect(result).not.toBeNull();
      expect(result!.number).toBe(123);
      expect(result!.url).toBe('https://github.com/owner/repo/pull/123');
      expect(result!.state).toBe('OPEN');
      expect(result!.isDraft).toBe(false);
      expect(result!.mergeStateStatus).toBe('CLEAN');
      expect(result!.headRefName).toBe('feature-branch');
      expect(result!.baseRefName).toBe('main');
      expect(result!.title).toBe('Add feature');
      expect(result!.author).toEqual({ login: 'octocat' });
      expect(result!.additions).toBe(10);
      expect(result!.deletions).toBe(5);
      expect(result!.changedFiles).toBe(3);
      expect(result!.autoMergeRequest).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseStatusResponse('github', '')).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      expect(parseStatusResponse('github', 'not json')).toBeNull();
    });
  });

  describe('gitlab', () => {
    it('normalizes a realistic glab mr view JSON response', () => {
      const raw = JSON.stringify({
        iid: 456,
        web_url: 'https://gitlab.com/owner/repo/-/merge_requests/456',
        state: 'opened',
        draft: false,
        work_in_progress: false,
        merge_status: 'can_be_merged',
        has_conflicts: false,
        source_branch: 'feature-branch',
        target_branch: 'main',
        title: 'Add feature',
        author: { username: 'gitlabuser', name: 'GitLab User' },
        additions: null,
        deletions: null,
        changes_count: '7',
        merge_when_pipeline_succeeds: false,
        updated_at: '2025-01-15T10:00:00Z',
      });
      const result = parseStatusResponse('gitlab', raw);
      expect(result).not.toBeNull();
      expect(result!.number).toBe(456);
      expect(result!.url).toBe('https://gitlab.com/owner/repo/-/merge_requests/456');
      expect(result!.state).toBe('OPEN');
      expect(result!.isDraft).toBe(false);
      expect(result!.mergeStateStatus).toBe('CLEAN');
      expect(result!.headRefName).toBe('feature-branch');
      expect(result!.baseRefName).toBe('main');
      expect(result!.title).toBe('Add feature');
      expect(result!.author).toEqual({ login: 'gitlabuser' });
      expect(result!.changedFiles).toBe(7);
      expect(result!.autoMergeRequest).toBeNull();
      expect(result!.updatedAt).toBe('2025-01-15T10:00:00Z');
    });

    it('maps state "closed" to CLOSED', () => {
      const raw = JSON.stringify({ iid: 1, state: 'closed' });
      const result = parseStatusResponse('gitlab', raw);
      expect(result!.state).toBe('CLOSED');
    });

    it('maps state "merged" to MERGED', () => {
      const raw = JSON.stringify({ iid: 1, state: 'merged' });
      const result = parseStatusResponse('gitlab', raw);
      expect(result!.state).toBe('MERGED');
    });

    it('detects draft from draft field', () => {
      const raw = JSON.stringify({ iid: 1, draft: true, work_in_progress: false });
      const result = parseStatusResponse('gitlab', raw);
      expect(result!.isDraft).toBe(true);
    });

    it('detects draft from work_in_progress field', () => {
      const raw = JSON.stringify({ iid: 1, draft: false, work_in_progress: true });
      const result = parseStatusResponse('gitlab', raw);
      expect(result!.isDraft).toBe(true);
    });

    it('maps merge_status cannot_be_merged to CONFLICTING', () => {
      const raw = JSON.stringify({
        iid: 1,
        merge_status: 'cannot_be_merged',
        has_conflicts: true,
      });
      const result = parseStatusResponse('gitlab', raw);
      expect(result!.mergeStateStatus).toBe('CONFLICTING');
    });

    it('prefers detailed_merge_status over merge_status', () => {
      const raw = JSON.stringify({
        iid: 1,
        merge_status: 'cannot_be_merged_recheck',
        detailed_merge_status: 'mergeable',
      });
      const result = parseStatusResponse('gitlab', raw);
      expect(result!.mergeStateStatus).toBe('CLEAN');
    });

    it('maps detailed_merge_status draft_status to BLOCKED', () => {
      const raw = JSON.stringify({
        iid: 1,
        merge_status: 'cannot_be_merged_recheck',
        detailed_merge_status: 'draft_status',
      });
      const result = parseStatusResponse('gitlab', raw);
      expect(result!.mergeStateStatus).toBe('BLOCKED');
    });

    it('maps detailed_merge_status conflict to CONFLICTING', () => {
      const raw = JSON.stringify({
        iid: 1,
        detailed_merge_status: 'conflict',
      });
      const result = parseStatusResponse('gitlab', raw);
      expect(result!.mergeStateStatus).toBe('CONFLICTING');
    });

    it('maps detailed_merge_status need_rebase to BEHIND', () => {
      const raw = JSON.stringify({
        iid: 1,
        detailed_merge_status: 'need_rebase',
      });
      const result = parseStatusResponse('gitlab', raw);
      expect(result!.mergeStateStatus).toBe('BEHIND');
    });

    it('treats merge_status recheck as CLEAN when no detailed_merge_status', () => {
      const raw = JSON.stringify({
        iid: 1,
        merge_status: 'cannot_be_merged_recheck',
      });
      const result = parseStatusResponse('gitlab', raw);
      expect(result!.mergeStateStatus).toBe('CLEAN');
    });

    it('maps merge_when_pipeline_succeeds to autoMergeRequest', () => {
      const raw = JSON.stringify({ iid: 1, merge_when_pipeline_succeeds: true });
      const result = parseStatusResponse('gitlab', raw);
      expect(result!.autoMergeRequest).toEqual({ enabledBy: {} });
    });

    it('returns null for empty string', () => {
      expect(parseStatusResponse('gitlab', '')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// parseListResponse
// ---------------------------------------------------------------------------
describe('parseListResponse', () => {
  describe('github', () => {
    it('parses a realistic gh pr list JSON response', () => {
      const raw = JSON.stringify([
        {
          number: 1,
          title: 'PR One',
          headRefName: 'branch-1',
          baseRefName: 'main',
          url: 'https://github.com/owner/repo/pull/1',
          isDraft: false,
          updatedAt: '2025-01-15T10:00:00Z',
          author: { login: 'dev1' },
          additions: 10,
          deletions: 3,
        },
        {
          number: 2,
          title: 'PR Two',
          headRefName: 'branch-2',
          baseRefName: 'main',
          url: 'https://github.com/owner/repo/pull/2',
          isDraft: true,
          updatedAt: '2025-01-14T10:00:00Z',
          author: { login: 'dev2' },
          additions: 50,
          deletions: 20,
        },
      ]);
      const items = parseListResponse('github', raw);
      expect(items).toHaveLength(2);
      expect(items[0].number).toBe(1);
      expect(items[0].title).toBe('PR One');
      expect(items[0].headRefName).toBe('branch-1');
      expect(items[0].url).toBe('https://github.com/owner/repo/pull/1');
      expect(items[0].isDraft).toBe(false);
      expect(items[1].isDraft).toBe(true);
    });

    it('returns empty array for empty string', () => {
      expect(parseListResponse('github', '')).toEqual([]);
    });

    it('returns empty array for invalid JSON', () => {
      expect(parseListResponse('github', 'not json')).toEqual([]);
    });
  });

  describe('gitlab', () => {
    it('normalizes a realistic glab mr list JSON response', () => {
      const raw = JSON.stringify([
        {
          iid: 10,
          title: 'MR One',
          source_branch: 'branch-1',
          target_branch: 'main',
          web_url: 'https://gitlab.com/owner/repo/-/merge_requests/10',
          draft: false,
          work_in_progress: false,
          state: 'opened',
          updated_at: '2025-01-15T10:00:00Z',
          author: { username: 'dev1' },
          changes_count: '5',
        },
        {
          iid: 11,
          title: 'MR Two',
          source_branch: 'branch-2',
          target_branch: 'main',
          web_url: 'https://gitlab.com/owner/repo/-/merge_requests/11',
          draft: true,
          work_in_progress: false,
          state: 'opened',
          updated_at: '2025-01-14T10:00:00Z',
          author: { username: 'dev2' },
          changes_count: '12',
        },
      ]);
      const items = parseListResponse('gitlab', raw);
      expect(items).toHaveLength(2);
      expect(items[0].number).toBe(10);
      expect(items[0].title).toBe('MR One');
      expect(items[0].headRefName).toBe('branch-1');
      expect(items[0].baseRefName).toBe('main');
      expect(items[0].url).toBe('https://gitlab.com/owner/repo/-/merge_requests/10');
      expect(items[0].isDraft).toBe(false);
      expect(items[0].state).toBe('OPEN');
      expect(items[1].isDraft).toBe(true);
      expect(items[1].number).toBe(11);
    });

    it('extracts checksStatus from head_pipeline', () => {
      const raw = JSON.stringify([
        {
          iid: 20,
          title: 'MR with pipeline',
          source_branch: 'feat',
          target_branch: 'main',
          web_url: 'https://gitlab.com/owner/repo/-/merge_requests/20',
          state: 'opened',
          author: { username: 'dev1' },
          head_pipeline: { id: 100, status: 'success' },
        },
        {
          iid: 21,
          title: 'MR with failed pipeline',
          source_branch: 'fix',
          target_branch: 'main',
          web_url: 'https://gitlab.com/owner/repo/-/merge_requests/21',
          state: 'opened',
          author: { username: 'dev2' },
          head_pipeline: { id: 101, status: 'failed' },
        },
        {
          iid: 22,
          title: 'MR with running pipeline',
          source_branch: 'dev',
          target_branch: 'main',
          web_url: 'https://gitlab.com/owner/repo/-/merge_requests/22',
          state: 'opened',
          author: { username: 'dev3' },
          head_pipeline: { id: 102, status: 'running' },
        },
        {
          iid: 23,
          title: 'MR without pipeline',
          source_branch: 'chore',
          target_branch: 'main',
          web_url: 'https://gitlab.com/owner/repo/-/merge_requests/23',
          state: 'opened',
          author: { username: 'dev4' },
        },
      ]);
      const items = parseListResponse('gitlab', raw);
      expect(items[0].checksStatus).toBe('pass');
      expect(items[1].checksStatus).toBe('fail');
      expect(items[2].checksStatus).toBe('pending');
      expect(items[3].checksStatus).toBe('none');
    });

    it('returns empty array for empty string', () => {
      expect(parseListResponse('gitlab', '')).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// Error pattern helpers
// ---------------------------------------------------------------------------
describe('isPrAlreadyExistsError', () => {
  it('github: matches "already exists"', () => {
    expect(isPrAlreadyExistsError('github', 'a pull request already exists for branch foo')).toBe(
      true
    );
  });

  it('github: matches "already has"', () => {
    expect(isPrAlreadyExistsError('github', 'repo already has a pull request')).toBe(true);
  });

  it('github: matches "pull request for branch"', () => {
    expect(isPrAlreadyExistsError('github', 'pull request for branch feature-1 into main')).toBe(
      true
    );
  });

  it('github: does not match unrelated text', () => {
    expect(isPrAlreadyExistsError('github', 'something went wrong')).toBe(false);
  });

  it('gitlab: matches "already exists"', () => {
    expect(isPrAlreadyExistsError('gitlab', 'merge request already exists')).toBe(true);
  });

  it('gitlab: matches "merge request already exists"', () => {
    expect(
      isPrAlreadyExistsError('gitlab', 'Another open merge request already exists for this')
    ).toBe(true);
  });

  it('gitlab: does not match unrelated text', () => {
    expect(isPrAlreadyExistsError('gitlab', 'something went wrong')).toBe(false);
  });
});

describe('isCliNotInstalledError', () => {
  it('matches "not installed"', () => {
    expect(isCliNotInstalledError('gh: not installed')).toBe(true);
  });

  it('matches "command not found"', () => {
    expect(isCliNotInstalledError('bash: glab: command not found')).toBe(true);
  });

  it('does not match unrelated text', () => {
    expect(isCliNotInstalledError('authentication failed')).toBe(false);
  });
});

describe('isPrNotFoundError', () => {
  it('github: matches "no pull requests found"', () => {
    expect(isPrNotFoundError('github', 'no pull requests found for branch')).toBe(true);
  });

  it('github: matches "not found"', () => {
    expect(isPrNotFoundError('github', 'pull request not found')).toBe(true);
  });

  it('github: does not match unrelated text', () => {
    expect(isPrNotFoundError('github', 'authentication error')).toBe(false);
  });

  it('gitlab: matches "not found"', () => {
    expect(isPrNotFoundError('gitlab', 'merge request not found')).toBe(true);
  });

  it('gitlab: matches "404"', () => {
    expect(isPrNotFoundError('gitlab', 'error: 404 Not Found')).toBe(true);
  });

  it('gitlab: does not match unrelated text', () => {
    expect(isPrNotFoundError('gitlab', 'authentication error')).toBe(false);
  });
});

describe('extractUrlFromOutput', () => {
  it('github: extracts any https URL', () => {
    const output = 'Creating pull request...\nhttps://github.com/owner/repo/pull/42\nDone!';
    expect(extractUrlFromOutput('github', output)).toBe('https://github.com/owner/repo/pull/42');
  });

  it('github: extracts http URL', () => {
    const output = 'http://github.example.com/pull/1';
    expect(extractUrlFromOutput('github', output)).toBe('http://github.example.com/pull/1');
  });

  it('github: returns null when no URL present', () => {
    expect(extractUrlFromOutput('github', 'no url here')).toBeNull();
  });

  it('gitlab: extracts merge_requests URL', () => {
    const output =
      'Creating merge request...\nhttps://gitlab.com/owner/repo/-/merge_requests/99\nDone!';
    expect(extractUrlFromOutput('gitlab', output)).toBe(
      'https://gitlab.com/owner/repo/-/merge_requests/99'
    );
  });

  it('gitlab: returns null when URL does not match merge_requests pattern', () => {
    expect(extractUrlFromOutput('gitlab', 'https://gitlab.com/owner/repo')).toBeNull();
  });

  it('gitlab: returns null when no URL present', () => {
    expect(extractUrlFromOutput('gitlab', 'no url here')).toBeNull();
  });
});
