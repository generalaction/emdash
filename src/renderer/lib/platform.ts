/**
 * Platform identifier constants
 * These match Node.js process.platform values
 */
export const PLATFORM_MAC = 'darwin' as const;
export const PLATFORM_WINDOWS = 'win32' as const;
export const PLATFORM_LINUX = 'linux' as const;

export type Platform = typeof PLATFORM_MAC | typeof PLATFORM_WINDOWS | typeof PLATFORM_LINUX;

/**
 * Check if the given platform string is macOS
 */
export function isMac(platform: string | undefined): boolean {
  return platform === PLATFORM_MAC;
}

/**
 * Check if the given platform string is Windows
 */
export function isWindows(platform: string | undefined): boolean {
  return platform === PLATFORM_WINDOWS;
}

/**
 * Check if the given platform string is Linux
 */
export function isLinux(platform: string | undefined): boolean {
  return platform === PLATFORM_LINUX;
}
