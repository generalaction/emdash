import { describe, expect, it } from 'vitest';
import { readStoredProjectSettings } from './migrations/stored-settings';

describe('readStoredProjectSettings', () => {
  it.each([
    { githubAccountId: ' github.com:42 ' },
    { githubAccount: { kind: 'account', accountId: 'github.com:42' } },
    { integrationAccounts: { github: { kind: 'account', accountId: 'github.com:42' } } },
  ])('normalizes every historical account representation through one reader', (stored) => {
    expect(readStoredProjectSettings(JSON.stringify(stored))).toEqual({
      integrationAccounts: { github: { kind: 'account', accountId: 'github.com:42' } },
    });
  });

  it('preserves explicit suppression and other providers over legacy keys', () => {
    expect(
      readStoredProjectSettings(
        JSON.stringify({
          githubAccountId: 'github.com:old',
          githubAccount: { kind: 'account', accountId: 'github.com:newer' },
          integrationAccounts: {
            github: { kind: 'none' },
            jira: { kind: 'account', accountId: 'jira:a' },
          },
        })
      )
    ).toEqual({
      integrationAccounts: {
        github: { kind: 'none' },
        jira: { kind: 'account', accountId: 'jira:a' },
      },
    });
  });

  it('keeps historical null as inference and structured none as suppression', () => {
    expect(readStoredProjectSettings('{"githubAccountId":null}')).toEqual({});
    expect(readStoredProjectSettings('{"githubAccount":{"kind":"none"}}')).toEqual({
      integrationAccounts: { github: { kind: 'none' } },
    });
  });
});
