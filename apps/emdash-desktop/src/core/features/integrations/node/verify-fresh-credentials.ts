import type { VerifyResult } from '@emdash/plugins/integrations';
import { systemClock, type Clock } from '@emdash/shared/scheduling';

/**
 * A provider can briefly reject a token it has just issued (seen on GitLab.com),
 * so a failed verification of fresh credentials is retried once after this delay.
 */
const RETRY_DELAY_MS = 1000;

/** Verifies credentials that were just issued, retrying a failure once; aborting skips the retry. */
export async function verifyFreshCredentials<T extends VerifyResult | undefined>(
  verify: () => Promise<T>,
  options: { signal?: AbortSignal; clock?: Pick<Clock, 'sleep'> } = {}
): Promise<T> {
  const verified = await verify();
  if (!verified || verified.connected || options.signal?.aborted) return verified;
  const waited = await (options.clock ?? systemClock)
    .sleep(RETRY_DELAY_MS, { signal: options.signal })
    .then(
      () => true,
      () => false
    );
  return waited ? await verify() : verified;
}
