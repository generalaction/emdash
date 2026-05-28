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
