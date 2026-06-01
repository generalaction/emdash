import { describe, expect, it, vi } from 'vitest';
import { getLocalTimeZone } from './timezone';

describe('getLocalTimeZone', () => {
  it('uses the runtime time zone', () => {
    expect(getLocalTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('falls back to UTC when the runtime does not report a time zone', () => {
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: undefined }),
    } as unknown as Intl.DateTimeFormat);

    try {
      expect(getLocalTimeZone()).toBe('UTC');
    } finally {
      spy.mockRestore();
    }
  });
});
