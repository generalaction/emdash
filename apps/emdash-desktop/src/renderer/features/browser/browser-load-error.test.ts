import { describe, expect, it } from 'vitest';
import { browserLoadErrorCode, browserLoadErrorTitle } from './browser-load-error';

describe('browser load error labels', () => {
  it('uses human-readable Chromium descriptions as the title', () => {
    const error = {
      code: -105,
      description: 'Name not resolved',
      url: 'https://missing.invalid/',
    };

    expect(browserLoadErrorTitle(error)).toBe('Name not resolved');
    expect(browserLoadErrorCode(error)).toBe('Error -105');
  });

  it('normalizes Chromium error constants', () => {
    const error = {
      code: -105,
      description: 'net::ERR_NAME_NOT_RESOLVED',
      url: 'https://missing.invalid/',
    };

    expect(browserLoadErrorTitle(error)).toBe('ERR_NAME_NOT_RESOLVED');
    expect(browserLoadErrorCode(error)).toBe('ERR_NAME_NOT_RESOLVED');
  });

  it('falls back when Electron omits a useful description', () => {
    expect(browserLoadErrorTitle({ description: '   ' })).toBe('Page failed to load');
    expect(browserLoadErrorCode({ description: '   ' })).toBeNull();
  });
});
