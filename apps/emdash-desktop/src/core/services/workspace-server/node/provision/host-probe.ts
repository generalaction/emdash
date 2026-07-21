import type { WorkspaceServerSshPort } from '../ports';

export type RemoteHostInfo = {
  home: string;
  os: 'linux' | 'darwin' | 'other';
  arch: 'x64' | 'arm64' | 'other';
};

export class RemoteHostProbe {
  private readonly cache = new Map<string, Promise<RemoteHostInfo>>();

  constructor(private readonly ssh: WorkspaceServerSshPort) {}

  probe(connectionId: string, signal?: AbortSignal): Promise<RemoteHostInfo> {
    const cached = this.cache.get(connectionId);
    if (cached) return cached;

    const pending = this.probeUncached(connectionId, signal).catch((error: unknown) => {
      if (this.cache.get(connectionId) === pending) this.cache.delete(connectionId);
      throw error;
    });
    this.cache.set(connectionId, pending);
    return pending;
  }

  drop(connectionId: string): void {
    this.cache.delete(connectionId);
  }

  private async probeUncached(connectionId: string, signal?: AbortSignal): Promise<RemoteHostInfo> {
    const proxy = await this.ssh.ensureProxy(connectionId);
    const result = await proxy.exec(`printf '%s\\n' "$HOME"; uname -s; uname -m`, {
      signal,
      timeoutMs: 10_000,
      maxStdoutBytes: 4_096,
      maxStderrBytes: 4_096,
    });
    if (result.exitCode !== 0) {
      throw new Error(`Remote host probe failed: ${result.stderr.trim() || result.exitCode}`);
    }
    const [home, osName, archName] = result.stdout.trim().split('\n');
    if (!home || !osName || !archName) {
      throw new Error('Remote host probe returned an incomplete response');
    }

    return {
      home,
      os: normalizeOs(osName),
      arch: normalizeArch(archName),
    };
  }
}

function normalizeOs(value: string): RemoteHostInfo['os'] {
  switch (value.toLowerCase()) {
    case 'linux':
      return 'linux';
    case 'darwin':
      return 'darwin';
    default:
      return 'other';
  }
}

function normalizeArch(value: string): RemoteHostInfo['arch'] {
  switch (value.toLowerCase()) {
    case 'x86_64':
    case 'amd64':
      return 'x64';
    case 'aarch64':
    case 'arm64':
      return 'arm64';
    default:
      return 'other';
  }
}
