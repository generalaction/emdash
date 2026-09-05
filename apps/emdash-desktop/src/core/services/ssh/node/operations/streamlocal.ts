import { TimeoutError } from '@emdash/shared/scheduling';
import type { Client, ClientChannel } from 'ssh2';

export function forwardOutStreamLocalOnClient(
  client: Client,
  socketPath: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', handleAbort);
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
    const handleAbort = () => fail(options.signal?.reason ?? new Error('Channel opening aborted'));
    const timeoutMs = options.timeoutMs ?? 10_000;
    const timer = setTimeout(() => fail(new TimeoutError(timeoutMs)), timeoutMs);
    timer.unref?.();
    if (options.signal?.aborted) {
      handleAbort();
      return;
    }
    options.signal?.addEventListener('abort', handleAbort, { once: true });

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
