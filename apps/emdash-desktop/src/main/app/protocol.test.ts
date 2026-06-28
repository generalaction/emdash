import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  net: {
    fetch: vi.fn(),
  },
  protocol: {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
  },
}));

const { fileUrlForPath } = await import('./protocol');

describe('app protocol paths', () => {
  it('formats Windows file paths as valid file URLs', () => {
    expect(fileUrlForPath('C:\\Users\\Jan\\My App\\index.html')).toBe(
      'file:///C:/Users/Jan/My%20App/index.html'
    );
  });
});
