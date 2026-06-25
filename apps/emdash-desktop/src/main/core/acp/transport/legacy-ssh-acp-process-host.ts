import type { Readable, Writable } from 'node:stream';
import type { AcpFs, AcpProcessHandle, AcpProcessHost } from '@emdash/core/acp';
import type { ClientChannel } from 'ssh2';
import { getPlugin } from '@main/core/agents/plugin-registry';
import { resolveAgentExecutable } from '@main/core/conversations/impl/resolve-agent-executable';
import { hostDependencyStore } from '@main/core/dependencies/host-dependency-store';
import {
  buildSshCommand,
  SshExecutionContext,
} from '@main/core/execution-context/ssh-execution-context';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { buildAgentEnv } from '@main/core/pty/pty-env';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { quoteShellArg } from '@main/utils/shellEscape';

// ---------------------------------------------------------------------------
// SshChannelHandle: wraps an SSH ClientChannel as an AcpProcessHandle
// ---------------------------------------------------------------------------

class SshChannelHandle implements AcpProcessHandle {
  private _exitCode: number | null = null;

  constructor(private readonly channel: ClientChannel) {}

  get stdin() {
    // On a non-PTY exec channel, the channel itself is writable (it is stdin).
    return this.channel as unknown as NodeJS.WritableStream & Writable;
  }

  get stdout(): Readable {
    // The channel is also readable as stdout.
    return this.channel as unknown as Readable;
  }

  get stderr(): Readable | undefined {
    // ssh2 exposes a separate stderr readable on non-PTY exec channels.
    return (this.channel as { stderr?: Readable }).stderr;
  }

  get exitCode(): number | null {
    return this._exitCode;
  }

  onExit(cb: (code: number | null) => void): void {
    this.channel.on('close', (code: number | null) => {
      this._exitCode = code ?? null;
      cb(code ?? null);
    });
  }

  onError(cb: (err: Error) => void): void {
    this.channel.on('error', cb);
  }

  kill(_signal?: NodeJS.Signals): void {
    // ssh2 does not expose a reliable remote signal-send mechanism for non-PTY
    // exec channels; closing the channel is the best available approximation.
    try {
      this.channel.close();
    } catch {
      // ignore — channel may already be closed
    }
  }
}

// ---------------------------------------------------------------------------
// SshAcpFs: adapts SshFileSystem to the AcpFs interface
// ---------------------------------------------------------------------------

class SshAcpFs implements AcpFs {
  // Use '/' as the base path — the ACP protocol always supplies absolute paths.
  private readonly sshFs: SshFileSystem;

  constructor(proxy: SshClientProxy) {
    this.sshFs = new SshFileSystem(proxy, '/');
  }

  async readFile(filePath: string, _encoding: 'utf8'): Promise<string> {
    const result = await this.sshFs.read(filePath, /* maxBytes — no limit */ Infinity);
    return result.content;
  }

  async writeFile(filePath: string, content: string, _encoding: 'utf8'): Promise<void> {
    await this.sshFs.write(filePath, content);
  }

  async mkdir(dirPath: string, opts: { recursive: boolean }): Promise<unknown> {
    await this.sshFs.mkdir(dirPath, opts);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// LegacySshAcpProcessHost
// ---------------------------------------------------------------------------

/**
 * ACP process host that runs the agent over an existing SSH connection.
 * Uses a plain exec channel (no PTY) so that stdin/stdout are framed cleanly
 * for JSON-RPC — PTY channels mix signal handling and may mangle binary frames.
 *
 * This is the "legacy" bridge: once a workspace server is running on the remote
 * machine this host will be replaced by a gRPC/WebSocket transport.
 */
export class LegacySshAcpProcessHost implements AcpProcessHost {
  readonly fs: AcpFs;

  constructor(private readonly proxy: SshClientProxy) {
    this.fs = new SshAcpFs(proxy);
  }

  async resolveSpawnContext(
    providerId: string
  ): Promise<{ cli: string; agentEnv: Record<string, string> }> {
    const rawEnv = buildAgentEnv({ agentApiVars: true });
    const filteredEnv = Object.fromEntries(
      Object.entries(rawEnv).filter((e): e is [string, string] => e[1] !== undefined)
    );

    const plugin = getPlugin(providerId);
    const binaryName = plugin.capabilities.hostDependency.binaryNames[0] ?? providerId;

    const cli = await resolveAgentExecutable({
      providerId,
      binaryName,
      ctx: new SshExecutionContext(this.proxy),
      hostDependencyStore,
      connectionId: this.proxy.connectionId,
    });

    return { cli, agentEnv: filteredEnv };
  }

  async spawn(spec: {
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd: string;
  }): Promise<AcpProcessHandle> {
    const profile = await this.proxy.getRemoteShellProfile();

    // Build "KEY=value KEY2=value2 command arg1 arg2" prefix for env vars.
    const envPrefix = Object.entries(spec.env)
      .map(([k, v]) => `${k}=${quoteShellArg(v)}`)
      .join(' ');

    const argsStr = spec.args.map(quoteShellArg).join(' ');
    const innerCmd = envPrefix
      ? `${envPrefix} ${spec.command} ${argsStr}`.trimEnd()
      : `${spec.command} ${argsStr}`.trimEnd();

    // buildSshCommand wraps the inner command with the remote shell profile
    // (sourcing ~/.bashrc etc.) and a `cd <cwd> &&` prefix.
    const fullCmd = buildSshCommand(spec.cwd, innerCmd, [], profile);

    return new Promise<AcpProcessHandle>((resolve, reject) => {
      this.proxy.exec(fullCmd, (err, channel) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(new SshChannelHandle(channel));
      });
    });
  }
}
