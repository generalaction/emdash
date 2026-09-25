import { describe, expect, it } from 'vitest';
import { formatUpdaterError, getUpdaterErrorDetails } from './utils';

describe('updater diagnostics', () => {
  const credentialUrl =
    'https://release-user:release-pass@updates.example.com/archive.zip?token=secret-value';
  it.each([
    ['string message', `Cannot download ${credentialUrl}`],
    ['error message', new Error(`Cannot download ${credentialUrl}`)],
    [
      'http status text',
      Object.assign(new Error('Cannot download update'), {
        statusCode: 502,
        statusMessage: `Failed to fetch ${credentialUrl}`,
      }),
    ],
  ])('redacts URL credentials and tokens from %s', (_source, error) => {
    for (const output of [getUpdaterErrorDetails(error), formatUpdaterError(error)]) {
      expect(output).toContain(
        'https://[REDACTED_CREDENTIALS]@updates.example.com/archive.zip?token=[REDACTED]'
      );
      expect(output).not.toContain('release-user');
      expect(output).not.toContain('release-pass');
      expect(output).not.toContain('secret-value');
    }
  });
  it('preserves the underlying HTTP diagnostic as well as the status summary', () => {
    const error = Object.assign(new Error('Cannot download archive.zip?token=secret-value'), {
      statusCode: 502,
      statusMessage: 'Bad Gateway',
    });
    expect(formatUpdaterError(error)).toBe('Update request failed with HTTP 502: Bad Gateway');
    expect(getUpdaterErrorDetails(error)).toContain('Cannot download archive.zip');
    expect(getUpdaterErrorDetails(error)).not.toContain('secret-value');
  });
  it('keeps full sanitized details independently of the short summary', () => {
    const error = new Error(`Download failed: ${'diagnostic '.repeat(50)}token=secret-value`);
    expect(formatUpdaterError(error).length).toBe(241);
    const details = getUpdaterErrorDetails(error);
    expect(details.length).toBeGreaterThan(240);
    expect(details).not.toContain('secret-value');
    expect(details).toContain('[REDACTED]');
  });
  it('does not include HTML response bodies in diagnostics', () => {
    expect(
      getUpdaterErrorDetails(new Error('Download failed Data: <html>private response</html>'))
    ).toBe('Download failed');
    expect(getUpdaterErrorDetails(null)).toBe('Unknown update error');
  });
});
