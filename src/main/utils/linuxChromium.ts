export interface ChromiumCommandLine {
  appendSwitch: (switchName: string, value?: string) => void;
}

function getWaylandTextInputVersion(env: NodeJS.ProcessEnv): string | null {
  const raw = env.EMDASH_WAYLAND_TEXT_INPUT_VERSION?.trim();
  return raw ? raw : null;
}

function hasWaylandSession(env: NodeJS.ProcessEnv): boolean {
  const sessionType = env.XDG_SESSION_TYPE?.toLowerCase();
  const ozonePlatform = env.OZONE_PLATFORM?.toLowerCase();
  const ozonePlatformHint = env.ELECTRON_OZONE_PLATFORM_HINT?.toLowerCase();

  return (
    Boolean(env.WAYLAND_DISPLAY) ||
    sessionType === 'wayland' ||
    ozonePlatform === 'wayland' ||
    ozonePlatformHint === 'wayland'
  );
}

export function configureLinuxChromium(
  commandLine: ChromiumCommandLine,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): void {
  if (platform !== 'linux') return;

  // Prefer native Wayland when available, but fall back to X11 automatically.
  commandLine.appendSwitch('ozone-platform-hint', 'auto');

  if (!hasWaylandSession(env)) return;

  // Electron on Wayland still needs explicit IME opt-in.
  commandLine.appendSwitch('enable-wayland-ime');

  const textInputVersion = getWaylandTextInputVersion(env);
  if (!textInputVersion) return;

  // Leave protocol version selection opt-in. wlroots compositors and Electron builds
  // can behave differently here, so users may need to experiment locally.
  commandLine.appendSwitch('wayland-text-input-version', textInputVersion);
}
