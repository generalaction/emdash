import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import { pullRequestRepositoryScope } from './pr-utils';

describe('pullRequestRepositoryScope', () => {
  it('matches pull requests by base or head repository URL', () => {
    const dialect = new SQLiteSyncDialect();

    const query = dialect.sqlToQuery(
      pullRequestRepositoryScope(['https://github.com/contributor/repo'])
    );

    expect(query.sql).toContain('"pull_requests"."repository_url"');
    expect(query.sql).toContain('"pull_requests"."head_repository_url"');
    expect(query.sql).toContain(' or ');
    expect(query.params).toEqual([
      'https://github.com/contributor/repo',
      'https://github.com/contributor/repo',
    ]);
  });

  it('requires at least one repository URL', () => {
    expect(() => pullRequestRepositoryScope([])).toThrow(
      'pullRequestRepositoryScope requires at least one repository URL'
    );
  });
});
