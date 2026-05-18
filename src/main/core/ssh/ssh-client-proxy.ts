import type { Client, ClientCallback, ClientSFTPCallback, ExecOptions, SFTPWrapper } from 'ssh2';
import { captureRemoteShellProfile, type RemoteShellProfile } from './remote-shell-profile';

type RemoteShellProfileState =
  | { kind: 'empty' }
  | { kind: 'loading'; client: Client; promise: Promise<RemoteShellProfile> }
  | { kind: 'ready'; client: Client; profile: RemoteShellProfile };

type SftpState =
  | { kind: 'empty' }
  | { kind: 'loading'; client: Client; callbacks: ClientSFTPCallback[] }
  | { kind: 'ready'; client: Client; sftp: SFTPWrapper };

/**
 * Stable reference to an ssh2 Client that survives reconnects.
 *
 * Services like SshFileSystem and SshGitService hold a SshClientProxy
 * rather than a raw Client. SshConnectionManager calls update() each time
 * a connection is established (including after reconnect) and invalidate()
 * when the connection drops. Callers that access proxy.client at call time
 * therefore always get the current live Client without needing to be
 * rebuilt or replaced.
 */
export class SshClientProxy {
  private _client: Client | null = null;
  private _remoteShellProfileState: RemoteShellProfileState = { kind: 'empty' };
  private _sftpState: SftpState = { kind: 'empty' };

  constructor(
    readonly connectionId: string,
    private healthReporter?: {
      reportChannelError(connectionId: string, error: unknown): void;
      reportChannelRecovered?(connectionId: string): void;
    }
  ) {}

  /** Called by SshConnectionManager when a connection becomes ready. */
  update(client: Client): void {
    if (this._client !== client) {
      this._remoteShellProfileState = { kind: 'empty' };
      this._sftpState = { kind: 'empty' };
    }
    this._client = client;
  }

  async getRemoteShellProfile(): Promise<RemoteShellProfile> {
    const client = this.client;
    const state = this._remoteShellProfileState;

    if (state.kind === 'ready' && state.client === client) {
      return state.profile;
    }
    if (state.kind === 'loading' && state.client === client) {
      return state.promise;
    }

    const promise = captureRemoteShellProfile(this).then((profile) => {
      if (
        this._client === client &&
        this._remoteShellProfileState.kind === 'loading' &&
        this._remoteShellProfileState.promise === promise
      ) {
        this._remoteShellProfileState = { kind: 'ready', client, profile };
      }
      return profile;
    });
    this._remoteShellProfileState = { kind: 'loading', client, promise };
    return promise;
  }

  exec(command: string, callback: ClientCallback): void;
  exec(command: string, options: ExecOptions, callback: ClientCallback): void;
  exec(
    command: string,
    optionsOrCallback: ExecOptions | ClientCallback,
    callback?: ClientCallback
  ): void {
    const wrappedCallback = this.wrapClientCallback(
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback
    );

    if (typeof optionsOrCallback === 'function') {
      this.client.exec(command, wrappedCallback);
      return;
    }

    this.client.exec(command, optionsOrCallback, wrappedCallback);
  }

  execPty(command: string, options: ExecOptions, callback: ClientCallback): void {
    this.client.exec(command, options, this.wrapClientCallback(callback));
  }

  sftp(callback: ClientSFTPCallback): void {
    const client = this.client;
    const state = this._sftpState;

    // Reuse one SFTP session per SSH connection so short-lived filesystem
    // wrappers do not exhaust servers with low MaxSessions limits.
    if (state.kind === 'ready' && state.client === client) {
      callback(undefined, state.sftp);
      return;
    }

    if (state.kind === 'loading' && state.client === client) {
      state.callbacks.push(callback);
      return;
    }

    this._sftpState = { kind: 'loading', client, callbacks: [callback] };

    client.sftp((err, sftp) => {
      this.reportChannelResult(err);
      const loadingState = this._sftpState;
      const callbacks =
        loadingState.kind === 'loading' && loadingState.client === client
          ? loadingState.callbacks
          : [callback];

      if (err || !sftp) {
        if (this._client === client && this._sftpState === loadingState) {
          this._sftpState = { kind: 'empty' };
        }
        for (const cb of callbacks) cb(err, sftp);
        return;
      }

      if (this._client === client && this._sftpState === loadingState) {
        this._sftpState = { kind: 'ready', client, sftp };
        sftp.on('close', () => {
          if (
            this._sftpState.kind === 'ready' &&
            this._sftpState.client === client &&
            this._sftpState.sftp === sftp
          ) {
            this._sftpState = { kind: 'empty' };
          }
        });
      }

      for (const cb of callbacks) cb(undefined, sftp);
    });
  }

  private wrapClientCallback(callback: ClientCallback | undefined): ClientCallback {
    return (err, channel) => {
      this.reportChannelResult(err);
      callback?.(err, channel);
    };
  }

  private reportChannelResult(err: Error | undefined): void {
    if (err) {
      this.healthReporter?.reportChannelError(this.connectionId, err);
      return;
    }
    this.healthReporter?.reportChannelRecovered?.(this.connectionId);
  }

  /** Called by SshConnectionManager when the connection drops. */
  invalidate(): void {
    this._client = null;
    this._remoteShellProfileState = { kind: 'empty' };
    this._sftpState = { kind: 'empty' };
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
}
