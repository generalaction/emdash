import type { Logger } from '@emdash/shared/logger';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import { createMarkdownIssuesBehavior, provider } from './index';
import type { BriefReaderDependencies, GitOutput } from './repository';

const PATTERN = 'docs/capabilities/*/*/tasks/WO-*.md';
const REPO = '/home/dev/fridayos';
const LOG_MARK = '\u0001';

const FILES: Record<string, string> = {
  'docs/capabilities/platform/connectors/tasks/WO-1811-retries.md': [
    '---',
    'status: in_review',
    '---',
    '',
    '# WO-1811: The backend context retries after an outage',
    '',
    'The desktop boots while core-api is unreachable.',
  ].join('\n'),
  'docs/capabilities/agents/governance/tasks/WO-1760-gate.md': [
    '---',
    'status: ready',
    '---',
    '',
    '# WO-1760: Governance gate and record',
  ].join('\n'),
};

function makeReader(): BriefReaderDependencies {
  return {
    git: vi.fn(async (_repositoryPath: string, args: readonly string[]): Promise<GitOutput> => {
      if (args[0] === 'rev-parse') return { status: 'ok', stdout: 'abc123\n' };
      if (args.includes('ls-tree')) {
        return { status: 'ok', stdout: Object.keys(FILES).join('\0') };
      }
      if (args.includes('log')) {
        return {
          status: 'ok',
          stdout: [
            `${LOG_MARK}2026-09-15T09:00:00Z`,
            'docs/capabilities/platform/connectors/tasks/WO-1811-retries.md',
            '',
            `${LOG_MARK}2026-09-10T08:00:00Z`,
            'docs/capabilities/agents/governance/tasks/WO-1760-gate.md',
          ].join('\n'),
        };
      }
      if (args[0] === 'show') {
        const path = String(args[1]).split(':').slice(1).join(':');
        const text = FILES[path];
        return text
          ? { status: 'ok', stdout: text }
          : { status: 'failed', message: 'no such path' };
      }
      return { status: 'failed', message: 'unexpected' };
    }),
    readFile: vi.fn(async () => ''),
    readDirectory: vi.fn(async () => []),
    modifiedAt: vi.fn(async () => undefined),
  };
}

function makeHost(
  credentials: ConnectedIntegrationHostContext['credentials'] = {
    taskPattern: PATTERN,
    trunkRef: 'origin/HEAD',
  }
): ConnectedIntegrationHostContext {
  const log: Logger = {
    level: 'info',
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => log,
  };
  return { log, credentials };
}

const issues = createMarkdownIssuesBehavior(makeReader);

describe('markdown issues plugin', () => {
  it('declares that it needs a local repository path and no credentials', () => {
    expect(provider.capabilities.issues.requiredInputs).toEqual(['repositoryPath']);
    expect(provider.metadata.integrationId).toBe('markdown');
  });

  it('lists task files newest first', async () => {
    const result = await issues.listIssues(makeHost(), { limit: 10, repositoryPath: REPO });

    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          identifier: 'WO-1811',
          title: 'The backend context retries after an outage',
          status: 'review',
          project: 'platform/connectors',
          labels: ['platform/connectors'],
          updatedAt: '2026-09-15T09:00:00Z',
        }),
        expect.objectContaining({ identifier: 'WO-1760', status: 'todo' }),
      ],
    });
  });

  it('honours the limit', async () => {
    const result = await issues.listIssues(makeHost(), { limit: 1, repositoryPath: REPO });
    expect(result.success && result.data).toHaveLength(1);
  });

  it('applies the configured pattern and ref to the read', async () => {
    const reader = makeReader();
    const behavior = createMarkdownIssuesBehavior(() => reader);
    await behavior.listIssues(makeHost({ taskPattern: PATTERN, trunkRef: 'origin/main' }), {
      limit: 10,
      repositoryPath: REPO,
    });

    const calls = vi.mocked(reader.git).mock.calls.map(([, args]) => args);
    expect(calls[0]).toEqual(['rev-parse', '--verify', '--quiet', 'origin/main^{commit}']);
    expect(reader.readFile).not.toHaveBeenCalled();
  });

  it('refuses to list without a repository path', async () => {
    const result = await issues.listIssues(makeHost(), { limit: 10 });
    expect(result).toEqual({
      success: false,
      error: { type: 'invalid_input', message: expect.stringContaining('local repository') },
    });
  });

  it('reports a clear error when no node reader is installed', async () => {
    const behavior = createMarkdownIssuesBehavior(() => undefined);
    const result = await behavior.listIssues(makeHost(), { limit: 10, repositoryPath: REPO });
    expect(result).toEqual({
      success: false,
      error: { type: 'generic', message: expect.stringContaining('desktop process') },
    });
  });

  it('searches over identifier, title, labels and body', async () => {
    const host = makeHost();
    await expect(
      issues.searchIssues(host, { limit: 10, repositoryPath: REPO, searchTerm: 'wo-1760' })
    ).resolves.toEqual({
      success: true,
      data: [expect.objectContaining({ identifier: 'WO-1760' })],
    });
    await expect(
      issues.searchIssues(host, { limit: 10, repositoryPath: REPO, searchTerm: 'core-api' })
    ).resolves.toEqual({
      success: true,
      data: [expect.objectContaining({ identifier: 'WO-1811' })],
    });
    await expect(
      issues.searchIssues(host, { limit: 10, repositoryPath: REPO, searchTerm: 'governance' })
    ).resolves.toEqual({
      success: true,
      data: [expect.objectContaining({ identifier: 'WO-1760' })],
    });
  });

  it('returns an empty list for an empty search term without reading anything', async () => {
    const reader = makeReader();
    const behavior = createMarkdownIssuesBehavior(() => reader);
    const result = await behavior.searchIssues(makeHost(), {
      limit: 10,
      repositoryPath: REPO,
      searchTerm: '   ',
    });
    expect(result).toEqual({ success: true, data: [] });
    expect(reader.git).not.toHaveBeenCalled();
  });

  it('serves the whole file as issue context', async () => {
    const result = await issues.getIssue(makeHost(), {
      identifier: 'wo-1811',
      repositoryPath: REPO,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.context).toContain('The desktop boots while core-api is unreachable.');
  });

  it('reports an unknown identifier as not found', async () => {
    const result = await issues.getIssue(makeHost(), {
      identifier: 'WO-9999',
      repositoryPath: REPO,
    });
    expect(result).toEqual({
      success: false,
      error: { type: 'not_found_or_no_access', message: expect.stringContaining('WO-9999') },
    });
  });
});
