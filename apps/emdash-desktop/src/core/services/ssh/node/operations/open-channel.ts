import { abortableWait, systemClock, TimeoutError } from '@emdash/shared/scheduling';
import type { Client, ClientChannel } from 'ssh2';

/** Owns acquisition only. Once resolved, the caller owns the channel. */
export function openChannel(
  client: Client,
  kind: string,
  open: (callback: (error: Error | undefined, channel: ClientChannel) => void) => void,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<ClientChannel> {
  return abortableWait(options, ({ resolve, reject }) => {
    let finished = false;
    const fail = (error: unknown) => {
      finished = true;
      reject(error);
    };
    const timeoutMs = options.timeoutMs ?? 10_000;
    const timer = systemClock.schedule(timeoutMs, () => fail(new TimeoutError(timeoutMs)), {
      unref: true,
    });
    const onClose = () => fail(new Error(`SSH connection closed while opening ${kind} channel`));
    const onError = (error: Error) => fail(error);
    client.once('close', onClose);
    client.once('end', onClose);
    client.once('error', onError);
    try {
      open((error, channel) => {
        if (finished || options.signal?.aborted) {
          channel?.destroy();
          return;
        }
        finished = true;
        if (error) {
          channel?.destroy();
          reject(error);
        } else {
          resolve(channel);
        }
      });
    } catch (error) {
      fail(error);
    }
    return () => {
      finished = true;
      void timer.dispose();
      client.off('close', onClose);
      client.off('end', onClose);
      client.off('error', onError);
    };
  });
}
