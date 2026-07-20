import type { Client, ClientChannel } from 'ssh2';

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
export class SshClientProxy {
  private _client: Client | null = null;

  constructor(readonly connectionId: string) {}

  /** Called by SshConnectionManager when a connection becomes ready. */
  update(client: Client): void {
    this._client = client;
  }

  /** Called by SshConnectionManager when the connection drops. */
  invalidate(): void {
    this._client = null;
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

  /** Opens an OpenSSH streamlocal channel through the current live connection. */
  forwardOutStreamLocal(socketPath: string): Promise<ClientChannel> {
    const client = this.client;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        client.off('close', handleClose);
        client.off('end', handleClose);
        client.off('error', handleError);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const handleClose = () => {
        fail(new Error('SSH connection closed while opening streamlocal channel'));
      };
      const handleError = (error: Error) => {
        fail(error);
      };

      client.once('close', handleClose);
      client.once('end', handleClose);
      client.once('error', handleError);

      try {
        client.openssh_forwardOutStreamLocal(socketPath, (error, channel) => {
          if (settled) {
            channel?.destroy();
            return;
          }
          settled = true;
          cleanup();
          if (error) {
            reject(error);
            return;
          }
          resolve(channel);
        });
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
