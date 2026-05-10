import path from 'node:path';
import type { PlatformAdapter } from './types';

class PosixPlatformAdapter implements PlatformAdapter {
  readonly platform: NodeJS.Platform;
  readonly isWindows = false;
  readonly hookCommandKind = 'sh' as const;

  constructor(platform: NodeJS.Platform) {
    this.platform = platform;
  }

  augmentedPathEntries(): readonly string[] {
    return [];
  }

  augmentEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return { ...env };
  }

  pathsEqual(a: string, b: string): boolean {
    return a === b;
  }

  basenameAny(p: string): string {
    return path.posix.basename(p.replace(/\\/g, '/'));
  }

  preferredInteractiveShell(_env: NodeJS.ProcessEnv): string | null {
    return null;
  }
}

export function createPosixPlatformAdapter(platform: NodeJS.Platform): PlatformAdapter {
  return new PosixPlatformAdapter(platform);
}
