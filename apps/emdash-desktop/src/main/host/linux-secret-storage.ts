/** Chromium password-store backend that routes `safeStorage` through the Secret Service. */
export const LIBSECRET_PASSWORD_STORE = 'gnome-libsecret';

/**
 * Decide whether to force Chromium's libsecret (Secret Service) backend for
 * `safeStorage` on Linux.
 *
 * Chromium only auto-selects a Secret Service backend when `XDG_CURRENT_DESKTOP`
 * names a desktop it recognizes (GNOME, KDE, Unity, Cinnamon, …). On Hyprland,
 * sway, i3, dwm and other compositors — a growing slice of the Linux desktop —
 * it falls back to the plaintext `basic_text` backend even when a working Secret
 * Service is on the session bus, which breaks every encrypted-secret feature
 * (account sign-in, cached GitHub/Linear tokens, SSH credentials, …). See #1875.
 *
 * Force `gnome-libsecret` unless the desktop is KDE, which is left to its native
 * KWallet auto-detection. We intentionally do not infer Secret Service
 * availability from `DBUS_SESSION_BUS_ADDRESS`: it is only an address, services
 * may be activated on demand, and Chromium will report whether the requested
 * backend actually initialized. On GNOME the switch is a harmless no-op because
 * Chromium already picks libsecret there.
 */
export function shouldForceLibsecretBackend(
  env: NodeJS.ProcessEnv = process.env,
  options: { passwordStoreSwitchPresent?: boolean } = {}
): boolean {
  if (options.passwordStoreSwitchPresent) return false;
  return !isKdeDesktop(env);
}

function isKdeDesktop(env: NodeJS.ProcessEnv): boolean {
  const desktops = (env.XDG_CURRENT_DESKTOP ?? '')
    .split(':')
    .map((desktop) => desktop.trim().toLowerCase());

  return (
    desktops.some((desktop) => desktop === 'kde' || desktop === 'plasma') ||
    env.KDE_FULL_SESSION?.trim().toLowerCase() === 'true' ||
    Boolean(env.KDE_SESSION_VERSION?.trim())
  );
}
