import { normalizeProxyCommand } from './proxy-command';

export interface SshConnectionMetadata {
  worktreesDir?: string;
  proxyCommand?: string;
}

export function parseSshConnectionMetadata(metadata: string | null): SshConnectionMetadata {
  if (!metadata) {
    return {};
  }

  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    return {
      worktreesDir:
        typeof parsed.worktreesDir === 'string' && parsed.worktreesDir.trim()
          ? parsed.worktreesDir
          : undefined,
      proxyCommand:
        typeof parsed.proxyCommand === 'string'
          ? normalizeProxyCommand(parsed.proxyCommand)
          : undefined,
    };
  } catch {
    return {};
  }
}

export function serializeSshConnectionMetadata(metadata: SshConnectionMetadata): string {
  return JSON.stringify({
    worktreesDir: metadata.worktreesDir,
    proxyCommand: normalizeProxyCommand(metadata.proxyCommand),
  });
}
