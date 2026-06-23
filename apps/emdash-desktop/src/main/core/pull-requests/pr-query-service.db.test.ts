import { randomUUID } from 'node:crypto';
import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDb } from '@main/db/client';
import { projectRemotes, projects, pullRequests } from '@main/db/schema';
import { prQueryService } from './pr-query-service';

const mocks = vi.hoisted(() => ({
  db: undefined as AppDb | undefined,
}));

vi.mock('@main/db/client', () => ({
  get db() {
    if (!mocks.db) throw new Error('Test database not initialized');
    return mocks.db;
  },
}));

const PROJECT_ID = 'project-1';
const REPOSITORY_URL = 'https://github.com/acme/repo';
const OTHER_REPOSITORY_URL = 'https://github.com/acme/other';

function prRow(overrides: Partial<typeof pullRequests.$inferInsert>) {
  return {
    url: `https://github.com/acme/repo/pull/${overrides.identifier ?? randomUUID()}`,
    repositoryUrl: REPOSITORY_URL,
    baseRefName: 'main',
    baseRefOid: 'base-oid',
    headRepositoryUrl: REPOSITORY_URL,
    headRefName: 'feature/default',
    headRefOid: 'head-oid',
    identifier: '#1',
    title: 'Default PR',
    status: 'open',
    isDraft: 0,
    ...overrides,
  };
}

describe('PrQueryService', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    mocks.db = fixture.db;

    await fixture.db.insert(projects).values({
      id: PROJECT_ID,
      name: 'Project',
      path: '/repo',
    });
    await fixture.db.insert(projectRemotes).values({
      projectId: PROJECT_ID,
      remoteName: 'origin',
      remoteUrl: REPOSITORY_URL,
    });
  });

  afterEach(() => {
    fixture.close();
    mocks.db = undefined;
  });

  it('searches PR title, identifier, and head branch within repository and status scope', async () => {
    await fixture.db.insert(pullRequests).values([
      prRow({
        url: 'https://github.com/acme/repo/pull/1',
        identifier: '#1',
        title: 'Update create task modal',
        headRefName: 'feature/create-task-modal',
      }),
      prRow({
        url: 'https://github.com/acme/repo/pull/2',
        identifier: '#42',
        title: 'Unrelated title',
        headRefName: 'feature/unrelated',
      }),
      prRow({
        url: 'https://github.com/acme/repo/pull/3',
        identifier: '#3',
        title: 'Branch-only match',
        headRefName: 'jan/eng-1463-pr-search',
      }),
      prRow({
        url: 'https://github.com/acme/repo/pull/4',
        identifier: '#4',
        title: 'Closed branch-only match',
        headRefName: 'jan/eng-1463-closed',
        status: 'closed',
      }),
      prRow({
        url: 'https://github.com/acme/other/pull/5',
        repositoryUrl: OTHER_REPOSITORY_URL,
        headRepositoryUrl: OTHER_REPOSITORY_URL,
        identifier: '#5',
        title: 'Foreign repo branch-only match',
        headRefName: 'jan/eng-1463-foreign',
      }),
    ]);

    await expect(
      prQueryService.listPullRequests(PROJECT_ID, {
        repositoryUrl: REPOSITORY_URL,
        filters: { status: 'open' },
        searchQuery: 'eng-1463',
      })
    ).resolves.toMatchObject([
      {
        url: 'https://github.com/acme/repo/pull/3',
        headRefName: 'jan/eng-1463-pr-search',
      },
    ]);

    await expect(
      prQueryService.listPullRequests(PROJECT_ID, {
        repositoryUrl: REPOSITORY_URL,
        filters: { status: 'open' },
        searchQuery: '#42',
      })
    ).resolves.toMatchObject([{ url: 'https://github.com/acme/repo/pull/2' }]);

    await expect(
      prQueryService.listPullRequests(PROJECT_ID, {
        repositoryUrl: REPOSITORY_URL,
        filters: { status: 'open' },
        searchQuery: 'create task',
      })
    ).resolves.toMatchObject([{ url: 'https://github.com/acme/repo/pull/1' }]);
  });
});
