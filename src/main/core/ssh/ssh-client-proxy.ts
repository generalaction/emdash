import type { Client } from 'ssh2';

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
  private _remoteEnv: Record<string, string> | null = null;

  /** Called by SshConnectionManager when a connection becomes ready. */
  update(client: Client): void {
    this._client = client;
  }

  /**
   * Called by SshConnectionManager after the connection is ready with the
   * remote machine's login-shell environment. Stored here so downstream
   * consumers (probers, providers) can use it without re-capturing per command.
   */
  updateRemoteEnv(env: Record<string, string>): void {
    this._remoteEnv = env;
  }

  /** Called by SshConnectionManager when the connection drops. */
  invalidate(): void {
    this._client = null;
    this._remoteEnv = null;
  }

  /**
   * The remote machine's login-shell environment, captured once after the
   * connection becomes ready. `null` until the capture completes or if
   * capture failed — callers should fall back to `bash -l -c` in that case.
   */
  get remoteEnv(): Record<string, string> | null {
    return this._remoteEnv;
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
