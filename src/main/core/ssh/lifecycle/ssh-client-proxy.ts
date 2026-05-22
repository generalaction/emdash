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
 * Services like SshFileSystem hold a SshClientProxy rather than a raw Client.
 * SshConnectionManager calls update() each time a connection is established
 * (including after reconnect) and invalidate() when the connection drops.
 * Callers that access proxy.client at call time therefore always get the
 * current live Client without needing to be rebuilt or replaced.
 * The optional healthReporter (constructor) receives reportChannelError and
 * reportChannelRecovered notifications for channel health tracking.
 *
 * See sftp() for the shared SFTPWrapper ownership contract.
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

  async refreshRemoteShellProfile(): Promise<RemoteShellProfile> {
    const client = this.client;
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

  /**
   * Obtains the shared, long-lived SFTPWrapper for this SSH connection.
   *
   * CONTRACT (callers must obey):
   * - The returned SFTPWrapper is OWNED by SshClientProxy and cached for the
   *   lifetime of the underlying Client (reused across SshFileSystem, listFiles,
   *   future callers, etc.). This prevents exhausting the remote server's
   *   MaxSessions limit with short-lived wrappers.
   * - NEVER call .end(), .destroy(), or .close() (no-argument form) on the
   *   wrapper itself. Doing so closes the SFTP subsystem channel for EVERY
   *   consumer and will break remote filesystem operations until the next
   *   reconnect.
   * - The ONLY permitted close is sftp.close(handle: Buffer, callback) for
   *   handles obtained from open(), opendir(), etc.
   * - The proxy automatically clears its cache and will open a fresh channel
   *   on the next .sftp() call after a 'close' event.
   *
   * Treat the wrapper as borrowed, not owned. See SshFileSystem.getSftp()
   * for the recommended caching + 'close' listener pattern.
   *
   * @see https://github.com/mscdex/ssh2 (SFTP channel lifecycle)
   */
  sftp(callback: ClientSFTPCallback): void {
    if (!this.isConnected) {
      callback(new Error('SSH connection is not available'), undefined as unknown as SFTPWrapper);
      return;
    }
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

    const loadingState: SftpState = { kind: 'loading', client, callbacks: [callback] };
    this._sftpState = loadingState;

    client.sftp((err, sftp) => {
      const isCurrentClient = this._client === client;
      if (isCurrentClient) this.reportChannelResult(err);
      // Explicit drain avoids subtle in-place mutation of the loadingState's callbacks array
      const callbacks = [...loadingState.callbacks];
      loadingState.callbacks.length = 0;

      if (err || !sftp) {
        if (isCurrentClient && this._sftpState === loadingState) {
          this._sftpState = { kind: 'empty' };
        }
        for (const cb of callbacks) cb(err, sftp);
        return;
      }

      if (isCurrentClient && this._sftpState === loadingState) {
        this._sftpState = { kind: 'ready', client, sftp };
        sftp.once('close', () => {
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
