import { describe, expect, it } from 'vitest';
import { isFileTabLoading } from './file-tab-loading';

describe('isFileTabLoading', () => {
  it('stops loading an external file after its content has loaded', () => {
    expect(
      isFileTabLoading({
        isExternal: true,
        isExternalLoading: false,
        isMonacoFile: true,
        diskStatus: undefined,
      })
    ).toBe(false);
  });

  it('shows loading while an external file is being read', () => {
    expect(
      isFileTabLoading({
        isExternal: true,
        isExternalLoading: true,
        isMonacoFile: true,
        diskStatus: undefined,
      })
    ).toBe(true);
  });

  it('does not use the Monaco spinner for external non-Monaco files', () => {
    expect(
      isFileTabLoading({
        isExternal: true,
        isExternalLoading: true,
        isMonacoFile: false,
        diskStatus: undefined,
      })
    ).toBe(false);
  });

  it('uses the Monaco disk status for workspace files', () => {
    expect(
      isFileTabLoading({
        isExternal: false,
        isExternalLoading: false,
        isMonacoFile: true,
        diskStatus: 'loading',
      })
    ).toBe(true);
    expect(
      isFileTabLoading({
        isExternal: false,
        isExternalLoading: false,
        isMonacoFile: true,
        diskStatus: 'ready',
      })
    ).toBe(false);
  });
});
