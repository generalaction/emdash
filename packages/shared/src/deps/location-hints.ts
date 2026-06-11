import type { InstallMethod, Platform } from '@emdash/cli-agent-plugins';

/**
 * Path pattern strings checked via case-insensitive substring matching against
 * the realpath of a resolved binary. Used by inferMethod to identify the
 * install method from the binary's on-disk location.
 *
 * Patterns should be specific enough to avoid false positives but general
 * enough to match common install locations across OS versions. More specific
 * patterns (e.g. '/.cargo/bin/') are preferred over generic ones (e.g. '/home/').
 *
 * Methods are checked in declaration order; the first match wins. Place more
 * specific methods before broader fallbacks (e.g. homebrew before curl for macOS).
 */
export const INSTALL_METHOD_LOCATION_HINTS: Record<
  InstallMethod,
  Partial<Record<Platform, string[]>>
> = {
  'installer-macos': {
    macos: ['/applications/', '.app/contents/macos/'],
  },
  'installer-windows': {
    windows: ['\\appdata\\local\\programs\\', '\\program files (x86)\\', '\\program files\\'],
  },
  'installer-linux': {
    linux: ['/opt/bin/', '/opt/sbin/'],
  },
  homebrew: {
    macos: ['/opt/homebrew/', '/usr/local/cellar/', '/usr/local/opt/'],
    linux: ['/home/linuxbrew/', '/usr/local/cellar/'],
  },
  winget: {
    windows: ['\\windowsapps\\', '\\winget\\packages\\'],
  },
  powershell: {
    windows: ['\\powershell\\modules\\'],
  },
  npm: {
    macos: ['node_modules', '/.npm-global/', '/npm-packages/', '/.nvm/'],
    linux: ['node_modules', '/.npm-global/', '/npm-packages/', '/.nvm/'],
    windows: ['node_modules', '\\npm\\', '\\nvm\\'],
  },
  apt: {
    linux: ['/usr/bin/', '/usr/sbin/'],
  },
  curl: {
    macos: ['/.local/bin/', '/.local/share/'],
    linux: ['/.local/bin/', '/.local/share/'],
    windows: ['\\appdata\\local\\curl\\'],
  },
  pip: {
    macos: ['site-packages', '/library/python/', '/python@'],
    linux: ['site-packages', '/python3/'],
    windows: ['site-packages', '\\python\\'],
  },
  cargo: {
    macos: ['/.cargo/bin/'],
    linux: ['/.cargo/bin/'],
    windows: ['\\.cargo\\bin\\'],
  },
  other: {},
};

/**
 * Infers the install method from a binary's realpath.
 *
 * Checks each method's location hints for the given platform in declaration
 * order using case-insensitive substring matching. Returns the first matching
 * method, or null if no match is found (the caller should treat this as a bare
 * CLI install resolved via PATH).
 */
export function inferMethod(resolvedPath: string, platform: Platform): InstallMethod | null {
  const normalizedPath = resolvedPath.toLowerCase();

  for (const [method, platformHints] of Object.entries(INSTALL_METHOD_LOCATION_HINTS) as [
    InstallMethod,
    Partial<Record<Platform, string[]>>,
  ][]) {
    const hints = platformHints[platform];
    if (!hints || hints.length === 0) continue;
    for (const hint of hints) {
      if (normalizedPath.includes(hint.toLowerCase())) {
        return method;
      }
    }
  }

  return null;
}
