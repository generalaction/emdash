import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import type { ConnectConfig } from 'ssh2';
import type {
  SshChannelCallback,
  SshExecChannel,
  SshTransportClient,
} from '@core/primitives/ssh/api/node/ssh-transport-client';
import { OpenSshChannel } from './openssh-channel';
import {
  openSshMasterArgs,
  openSshSlaveArgs,
  validateOpenSshTarget,
  type OpenSshTarget,
} from './openssh-options';

export class OpenSshClient extends EventEmitter implements SshTransportClient {
  private master?: ChildProcessWithoutNullStreams;
  private directory?: string;
  private socket?: string;
  private ready = false;
  private closed = false;
  private readonly lifetime = new AbortController();
  private readonly channels = new Set<Duplex>();
  private readonly forwards = new Map<string, Promise<string>>();

  constructor(
    private readonly target: OpenSshTarget,
    private readonly sshPath = 'ssh'
  ) {
    super();
    validateOpenSshTarget(target);
  }

  connect(config: ConnectConfig): void {
    if (process.platform === 'win32')
      throw new Error('Kerberos SSH currently requires macOS or Linux');
    if (this.master || this.closed) throw new Error('SSH transport cannot be reused');
    // macOS 的默认临时目录很长；短私有目录避免超过 Unix socket 路径上限。
    this.directory = mkdtempSync(
      join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'emdash-ssh-')
    );
    this.socket = join(this.directory, 'ctl');
    const marker = `emdash-ready-${randomUUID()}`;
    const child = spawn(this.sshPath, openSshMasterArgs(this.target, this.socket, config, marker), {
      stdio: 'pipe',
      env: { ...process.env, SSH_ASKPASS_REQUIRE: 'never' },
    });
    this.master = child;
    this.watchMaster(child, marker);
  }

  private watchMaster(child: ChildProcessWithoutNullStreams, marker: string): void {
    let output = '';
    let diagnostic = '';
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.ready || this.closed) return;
      output = (output + chunk.toString()).slice(-8192);
      if (output.includes(`${marker}\n`)) {
        this.ready = true;
        this.emit('ready');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostic = (diagnostic + chunk.toString()).slice(-8192);
    });
    child.stdin.on('error', (error) => this.fail(error));
    child.on('error', (error) => this.fail(error));
    child.on('close', (code) => {
      if (!this.closed && !this.ready) {
        this.fail(
          new Error(
            `System SSH connection failed (exit ${code ?? 'signal'}). Run kinit and ssh <host> in a terminal first. ${diagnostic.trim()}`
          )
        );
      } else {
        this.destroy();
      }
    });
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.emit('error', error);
    this.destroy();
  }

  end(): void {
    this.destroy();
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this.lifetime.abort();
    for (const channel of this.channels) channel.destroy();
    this.channels.clear();
    this.master?.kill();
    if (this.directory) rmSync(this.directory, { recursive: true, force: true });
    this.emit('close');
  }

  private slaveArgs(): string[] {
    if (!this.ready || this.closed || !this.socket)
      throw new Error('SSH connection is not available');
    return openSshSlaveArgs(this.socket);
  }

  private track<T extends Duplex>(channel: T): T {
    this.channels.add(channel);
    channel.once('close', () => this.channels.delete(channel));
    return channel;
  }

  exec(command: string, callback: SshChannelCallback<SshExecChannel>): void {
    this.openProcess(['--', this.target.host, command], callback);
  }

  forwardOut(
    _sourceHost: string,
    _sourcePort: number,
    remoteHost: string,
    remotePort: number,
    callback: SshChannelCallback
  ): void {
    if (
      !/^[A-Za-z0-9._:[\]-]+$/.test(remoteHost) ||
      !Number.isInteger(remotePort) ||
      remotePort < 1 ||
      remotePort > 65535
    ) {
      callback(new Error('Invalid SSH TCP forwarding target'));
      return;
    }
    const host =
      remoteHost.includes(':') && !remoteHost.startsWith('[') ? `[${remoteHost}]` : remoteHost;
    this.openProcess(['-W', `${host}:${remotePort}`, '--', this.target.host], callback);
  }

  private openProcess(args: string[], callback: SshChannelCallback<SshExecChannel>): void {
    const child = spawn(this.sshPath, [...this.slaveArgs(), ...args], { stdio: 'pipe' });
    const channel = this.track(new OpenSshChannel(child));
    const earlyError = (error: Error) => callback(error);
    channel.once('error', earlyError);
    child.once('spawn', () => {
      channel.off('error', earlyError);
      // 关闭连接后延迟到达的 spawn 不得交付已失效通道。
      if (this.closed) {
        channel.destroy();
        callback(new Error('SSH connection closed'));
        return;
      }
      callback(undefined, channel);
    });
  }

  openssh_forwardOutStreamLocal(socketPath: string, callback: SshChannelCallback): void {
    if (!socketPath.startsWith('/') || /[:\r\n\0]/.test(socketPath)) {
      callback(new Error('Invalid SSH Unix socket path'));
      return;
    }
    void this.localForward(socketPath)
      .then((path) => {
        if (this.closed) throw new Error('SSH connection closed');
        const channel = this.track(createConnection(path));
        const onError = (error: Error) => callback(error);
        channel.once('error', onError);
        channel.once('connect', () => {
          channel.off('error', onError);
          callback(undefined, channel);
        });
      })
      .catch((error: unknown) =>
        callback(error instanceof Error ? error : new Error(String(error)))
      );
  }

  private localForward(remotePath: string): Promise<string> {
    const existing = this.forwards.get(remotePath);
    if (existing) return existing;
    if (!this.directory) throw new Error('SSH connection is not available');
    const localPath = join(this.directory, `f${this.forwards.size}`);
    const args = [
      ...this.slaveArgs(),
      '-O',
      'forward',
      '-L',
      `${localPath}:${remotePath}`,
      '--',
      this.target.host,
    ];
    const pending = new Promise<string>((resolve, reject) => {
      execFile(
        this.sshPath,
        args,
        { timeout: 10_000, maxBuffer: 8192, signal: this.lifetime.signal },
        (error, _stdout, stderr) => {
          if (error)
            reject(new Error(`SSH socket forwarding failed: ${stderr.trim() || error.message}`));
          else resolve(localPath);
        }
      );
    });
    this.forwards.set(remotePath, pending);
    return pending;
  }
}
