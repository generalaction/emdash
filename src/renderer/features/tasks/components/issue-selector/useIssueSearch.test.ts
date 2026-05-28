import { describe, expect, it } from 'vitest';
import { isProviderUsable } from './issue-provider-usability';

describe('isProviderUsable', () => {
  it('allows GitHub issues when repository capabilities support them without GitHub.com OAuth', () => {
    expect(
      isProviderUsable(
        'github',
        {
          connected: false,
          capabilities: {
            requiresProjectPath: false,
            requiresRepositoryUrl: true,
          },
        },
        { repositoryUrl: 'https://ghe.example.com/acme/repo' },
        'ghe.example.com'
      )
    ).toBe(true);
  });

  it('does not bypass connection checks for GitHub.com repositories', () => {
    expect(
      isProviderUsable(
        'github',
        {
          connected: false,
          capabilities: {
            requiresProjectPath: false,
            requiresRepositoryUrl: true,
          },
        },
        { repositoryUrl: 'https://github.com/acme/repo' },
        'github.com'
      )
    ).toBe(false);
  });

  it('does not allow GitHub issues for an unsupported repository without GitHub.com OAuth', () => {
    expect(
      isProviderUsable(
        'github',
        {
          connected: false,
          capabilities: {
            requiresProjectPath: false,
            requiresRepositoryUrl: true,
          },
        },
        { repositoryUrl: 'https://gitlab.example.com/acme/repo' },
        null
      )
    ).toBe(false);
  });
});
