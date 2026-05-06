import type { Client } from 'ssh2';
import { captureRemoteShellProfile, type RemoteShellProfile } from './remote-shell-profile';

type RemoteShellProfileState =
  | { kind: 'empty' }
  | { kind: 'loading'; client: Client; promise: Promise<RemoteShellProfile> }
  | { kind: 'ready'; client: Client; profile: RemoteShellProfile };

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

  /** Called by SshConnectionManager when a connection becomes ready. */
  update(client: Client): void {
    if (this._client !== client) {
      this._remoteShellProfileState = { kind: 'empty' };
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

    const promise = captureRemoteShellProfile(client).then((profile) => {
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

  /** Called by SshConnectionManager when the connection drops. */
  invalidate(): void {
    this._client = null;
    this._remoteShellProfileState = { kind: 'empty' };
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
