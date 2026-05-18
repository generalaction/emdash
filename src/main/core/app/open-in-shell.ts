import type { PlatformKey } from '@shared/openInApps';

export function quotePathForShell(path: string, platform: PlatformKey): string {
  if (platform === 'win32') return `"${path.replace(/"/g, '""')}"`;
  return `'${path.replace(/'/g, "'\\''")}'`;
}
