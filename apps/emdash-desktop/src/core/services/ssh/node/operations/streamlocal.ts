import type { Client, ClientChannel } from 'ssh2';

const DEFAULT_OPEN_TIMEOUT_MS = 10_000;

export function forwardOutStreamLocalOnClient(
  client: Client,
  socketPath: string,
  options: { timeoutMs?: number } = {}
): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutMs = options.timeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
    const timeout = setTimeout(
      () => fail(new Error(`Timed out after ${timeoutMs}ms opening SSH streamlocal channel`)),
      timeoutMs
    );
    timeout.unref();
    const cleanup = () => {
      clearTimeout(timeout);
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
