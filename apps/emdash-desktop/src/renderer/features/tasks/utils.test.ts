import { describe, expect, it } from 'vitest';
import { formatFetchErrorDetail, formatPushErrorDetail } from './utils';

describe('formatFetchErrorDetail', () => {
  it('suggests gh auth login for GitHub authentication failures', () => {
    const detail = formatFetchErrorDetail({
      type: 'auth_failed',
      message: "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    });

    expect(detail).toBe(
      'GitHub authentication failed. Run "gh auth login" on this machine, then try again.'
    );
  });

  it('points GitHub authentication fixes at the SSH machine for remote projects', () => {
    const detail = formatFetchErrorDetail(
      {
        type: 'auth_failed',
        message: 'git@github.com: Permission denied (publickey).',
      },
      { isSshProject: true }
    );

    expect(detail).toBe(
      'GitHub authentication failed. Run "gh auth login" on the remote SSH machine, then try again.'
    );
  });

  it('points generic Git authentication fixes at the SSH machine for remote projects', () => {
    const detail = formatFetchErrorDetail(
      {
        type: 'auth_failed',
        message: 'fatal: Authentication failed for https://gitlab.com/example/project.git',
      },
      { isSshProject: true }
    );

    expect(detail).toBe(
      'Git authentication failed. Authenticate Git on the remote SSH machine, then try again.'
    );
  });
});

describe('formatPushErrorDetail', () => {
  it('explains GitHub repository-not-found push failures as credential or write-access issues', () => {
    const detail = formatPushErrorDetail({
      type: 'error',
      message:
        "remote: Repository not found.\nfatal: repository 'https://github.com/orbit-logistics/orbit/' not found",
    });

    expect(detail).toBe(
      'GitHub could not find the repository, or your local Git credentials do not have write access.'
    );
  });

  it('explains disabled GitHub credential prompts as local Git authentication failures', () => {
    const detail = formatPushErrorDetail({
      type: 'auth_failed',
      message: "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    });

    expect(detail).toBe(
      'GitHub authentication failed. Authenticate Git on this machine, or configure a fork as the project push remote.'
    );
  });

  it('does not classify generic fatal repository messages as repository-not-found failures', () => {
    const message =
      "fatal: repository 'https://github.com/orbit-logistics/orbit/' is not accessible (You are missing read permission...)";
    const detail = formatPushErrorDetail({
      type: 'error',
      message,
    });

    expect(detail).toBe(message);
  });

  it('preserves unrelated git error messages', () => {
    const detail = formatPushErrorDetail({
      type: 'rejected',
      message: 'Updates were rejected because the remote contains work that you do not have.',
    });

    expect(detail).toBe(
      'Updates were rejected because the remote contains work that you do not have.'
    );
  });
});
