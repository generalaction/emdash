import { describe, expect, it, vi } from 'vitest';
import {
  configureBrowserVerificationSession,
  releaseBrowserVerificationSession,
} from './browser-profile-session';

const state = vi.hoisted(() => ({
  beforeRequest: null as
    | null
    | ((
        details: { url: string; resourceType: string },
        callback: (result: { cancel: boolean }) => void
      ) => void),
  permissionRequest: null as
    | null
    | ((webContents: unknown, permission: string, callback: (allowed: boolean) => void) => void),
  permissionCheck: null as null | ((webContents: unknown, permission: string) => boolean),
}));

vi.mock('electron', () => ({
  app: { getName: () => 'Emdash' },
  session: {
    fromPartition: () => ({
      getUserAgent: () => 'Mozilla Electron/1.0',
      setUserAgent: vi.fn(),
      setPermissionRequestHandler: (handler: typeof state.permissionRequest) => {
        state.permissionRequest = handler;
      },
      setPermissionCheckHandler: (handler: typeof state.permissionCheck) => {
        state.permissionCheck = handler;
      },
      webRequest: {
        onBeforeRequest: (filterOrListener: unknown, handler?: typeof state.beforeRequest) => {
          state.beforeRequest = filterOrListener === null ? null : (handler ?? null);
        },
        onBeforeSendHeaders: vi.fn(),
        onHeadersReceived: vi.fn(),
        onCompleted: vi.fn(),
        onErrorOccurred: vi.fn(),
      },
    }),
  },
}));

describe('configureBrowserVerificationSession', () => {
  it('installs an immutable origin filter and denies every page permission', () => {
    expect(
      configureBrowserVerificationSession(
        'persist:emdash-browser-loop-verification-run-profile-test',
        'http://127.0.0.1:4173'
      )
    ).toBe(true);

    const allowed = vi.fn();
    state.beforeRequest?.(
      { url: 'http://127.0.0.1:4173/settings', resourceType: 'mainFrame' },
      allowed
    );
    expect(allowed).toHaveBeenLastCalledWith({ cancel: false });
    state.beforeRequest?.(
      { url: 'https://example.com/escape', resourceType: 'mainFrame' },
      allowed
    );
    expect(allowed).toHaveBeenLastCalledWith({ cancel: true });
    state.beforeRequest?.(
      { url: 'https://backend.example.com/query', resourceType: 'xhr' },
      allowed
    );
    expect(allowed).toHaveBeenLastCalledWith({ cancel: false });

    const permission = vi.fn();
    state.permissionRequest?.({}, 'clipboard-sanitized-write', permission);
    expect(permission).toHaveBeenCalledWith(false);
    expect(state.permissionCheck?.({}, 'clipboard-sanitized-write')).toBe(false);

    expect(
      configureBrowserVerificationSession(
        'persist:emdash-browser-loop-verification-run-profile-test',
        'http://127.0.0.1:5173'
      )
    ).toBe(false);

    expect(
      releaseBrowserVerificationSession(
        'persist:emdash-browser-loop-verification-run-profile-test',
        'http://127.0.0.1:4173'
      )
    ).toBe(true);
    expect(state.beforeRequest).toBeNull();
    expect(state.permissionRequest).toBeNull();
    expect(state.permissionCheck).toBeNull();
    expect(
      configureBrowserVerificationSession(
        'persist:emdash-browser-loop-verification-run-profile-test',
        'http://127.0.0.1:4173'
      )
    ).toBe(false);
  });
});
