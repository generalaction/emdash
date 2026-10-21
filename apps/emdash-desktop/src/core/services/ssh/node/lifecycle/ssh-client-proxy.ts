import { formatCommandLine, type Command } from '@emdash/core/primitives/exec/api';
import type { Client, ClientChannel } from 'ssh2';
import type {
  SshClientProxy as SshClientProxyContract,
  SshExecOptions,
  SshExecResult,
  SshTcpTarget,
} from '@core/primitives/ssh/api/node/ssh-client-proxy';
import { execOnClient } from '../operations/exec';
import { openChannel } from '../operations/open-channel';

/**
 * Stable reference to an ssh2 Client that survives reconnects.
 *
 * SSH-backed services hold a SshClientProxy rather than a raw Client.
 * SshConnectionManager calls update() each time
 * a connection is established (including after reconnect) and invalidate()
 * when the connection drops. Callers that access proxy.client at call time
 * therefore always get the current live Client without needing to be
 * rebuilt or replaced.
 */
export class SshClientProxy implements SshClientProxyContract {
  private _client: Client | null = null;
  private connectionLifetime = new AbortController();

  constructor(readonly connectionId: string) {}

  /** Called by SshConnectionManager when a connection becomes ready. */
  update(client: Client): void {
    const previousLifetime = this.connectionLifetime;
    this.connectionLifetime = new AbortController();
    this._client = client;
    previousLifetime.abort(new Error('SSH connection replaced'));
  }

  /** Called by SshConnectionManager when the connection drops. */
  invalidate(): void {
    this._client = null;
    this.connectionLifetime.abort(new Error('SSH connection is not available'));
  }

  /**
   * The live ssh2 Client. Throws if the connection is not currently
   * established. Callers should check isConnected first if they want to
   * avoid throwing.
   */
  get client(): Client {
    if (!this._client) {
      throw new Error('SSH connection is not available');
    }
    return this._client;
  }

  /** True while an active connection is held. */
  get isConnected(): boolean {
    return this._client !== null;
  }

  async openTcpChannel(
    target: SshTcpTarget,
    options: { signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<ClientChannel> {
    const { client, signal } = this.captureConnection(options.signal);
    return openChannel(
      client,
      'TCP',
      (callback) => {
        client.forwardOut(
          target.sourceHost,
          target.sourcePort,
          target.remoteHost,
          target.remotePort,
          callback
        );
      },
      { ...options, signal }
    );
  }

  /** Opens an OpenSSH streamlocal channel through the current live connection. */
  forwardOutStreamLocal(
    socketPath: string,
    options?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<ClientChannel> {
    const { client, signal } = this.captureConnection(options?.signal);
    return openChannel(
      client,
      'streamlocal',
      (callback) => {
        client.openssh_forwardOutStreamLocal(socketPath, callback);
      },
      { ...options, signal }
    );
  }

  /** Runs a structured command through the current live connection with bounded resources. */
  exec(command: Command, options?: SshExecOptions): Promise<SshExecResult> {
    const { client, signal } = this.captureConnection(options?.signal);
    return execOnClient(client, formatCommandLine(command, 'posix'), { ...options, signal });
  }

  /** Runs an explicit POSIX shell script through the current live connection. */
  execScript(script: string, options?: SshExecOptions): Promise<SshExecResult> {
    const { client, signal } = this.captureConnection(options?.signal);
    return execOnClient(client, script, { ...options, signal });
  }

  /** Each operation stays bound to the physical connection on which it started. */
  private captureConnection(callerSignal?: AbortSignal): { client: Client; signal: AbortSignal } {
    return {
      client: this.client,
      signal: callerSignal
        ? AbortSignal.any([callerSignal, this.connectionLifetime.signal])
        : this.connectionLifetime.signal,
    };
  }
}
