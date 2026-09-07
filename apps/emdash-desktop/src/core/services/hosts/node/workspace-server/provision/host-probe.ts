import type { WorkspaceServerSshPort } from '../ports';

export const WINDOWS_SSH_UNSUPPORTED_MESSAGE = 'Windows SSH hosts are not supported';

export type RemoteHostInfo = { platform: 'posix'; home: string } | { platform: 'win32' };

const probeOptions = {
  timeoutMs: 10_000,
  maxStdoutBytes: 4_096,
  maxStderrBytes: 4_096,
} as const;

export class RemoteHostProbe {
  private cached: Promise<RemoteHostInfo> | undefined;

  constructor(
    private readonly connectionId: string,
    private readonly ssh: WorkspaceServerSshPort
  ) {}

  probe(signal?: AbortSignal): Promise<RemoteHostInfo> {
    if (this.cached) return this.cached;

    const pending = this.probeUncached(signal).catch((error: unknown) => {
      if (this.cached === pending) this.cached = undefined;
      throw error;
    });
    this.cached = pending;
    return pending;
  }

  drop(): void {
    this.cached = undefined;
  }

  private async probeUncached(signal?: AbortSignal): Promise<RemoteHostInfo> {
    const proxy = await this.ssh.ensureProxy(this.connectionId);
    const platform = await proxy.exec(
      { command: 'uname', args: ['-s'] },
      { ...probeOptions, signal }
    );
    if (platform.exitCode === 0) {
      const platformName = platform.stdout.trim();
      if (!platformName) {
        throw new Error('Remote platform probe returned an incomplete response');
      }
      if (/^(?:cygwin|mingw|msys)/i.test(platformName)) return { platform: 'win32' };
    } else {
      const windows = await proxy.exec(
        { command: 'cmd.exe', args: ['/d', '/s', '/c', 'ver'] },
        { ...probeOptions, signal }
      );
      if (windows.exitCode === 0) return { platform: 'win32' };
      throw new Error(
        `Remote platform probe failed: ${platform.stderr.trim() || windows.stderr.trim() || platform.exitCode}`
      );
    }

    const result = await proxy.execScript(`printf '%s\\n' "$HOME"`, {
      ...probeOptions,
      signal,
    });
    if (result.exitCode !== 0) {
      throw new Error(`Remote host probe failed: ${result.stderr.trim() || result.exitCode}`);
    }
    const home = result.stdout.trim();
    if (!home) {
      throw new Error('Remote host probe returned an incomplete response');
    }

    return { platform: 'posix', home };
  }
}
