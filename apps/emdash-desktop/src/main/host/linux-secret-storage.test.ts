import { describe, expect, it } from 'vitest';
import { shouldForceLibsecretBackend } from './linux-secret-storage';

describe('shouldForceLibsecretBackend', () => {
  it('forces libsecret on an unrecognized desktop without relying on D-Bus environment', () => {
    expect(
      shouldForceLibsecretBackend({
        XDG_CURRENT_DESKTOP: 'Hyprland',
      })
    ).toBe(true);
  });

  it('forces libsecret when no desktop is advertised', () => {
    expect(shouldForceLibsecretBackend({})).toBe(true);
  });

  it('returns true on GNOME (harmless — Chromium already selects libsecret there)', () => {
    expect(
      shouldForceLibsecretBackend({
        XDG_CURRENT_DESKTOP: 'ubuntu:GNOME',
      })
    ).toBe(true);
  });

  it('leaves KDE to its native kwallet backend', () => {
    expect(
      shouldForceLibsecretBackend({
        XDG_CURRENT_DESKTOP: 'KDE',
      })
    ).toBe(false);
    expect(
      shouldForceLibsecretBackend({
        XDG_CURRENT_DESKTOP: 'plasma:KDE',
      })
    ).toBe(false);
    expect(
      shouldForceLibsecretBackend({
        XDG_CURRENT_DESKTOP: 'Plasma',
      })
    ).toBe(false);
    expect(shouldForceLibsecretBackend({ KDE_FULL_SESSION: 'true' })).toBe(false);
    expect(shouldForceLibsecretBackend({ KDE_SESSION_VERSION: '6' })).toBe(false);
  });

  it('does not override an explicit password-store switch', () => {
    expect(
      shouldForceLibsecretBackend(
        {
          XDG_CURRENT_DESKTOP: 'Hyprland',
        },
        { passwordStoreSwitchPresent: true }
      )
    ).toBe(false);
  });
});
