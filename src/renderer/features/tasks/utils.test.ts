import { describe, expect, it } from 'vitest';
import { formatPushErrorDetail } from './utils';

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
