import type { Logger } from '@emdash/shared/logger';
import { createController, type Controller } from '@emdash/wire/rpc';
import { waitlistContract } from '../api/contract';
import { joinWaitlist, type WaitlistSignupConfig } from './join-waitlist';

export type WaitlistOperations = {
  /** Resolves the Supabase project and the source tag for this build. */
  getSignupConfig(): Promise<WaitlistSignupConfig>;
};

export function createWaitlistWireController(
  operations: WaitlistOperations,
  logger: Logger
): Controller {
  return createController(waitlistContract, {
    join: async ({ email, note }) => {
      try {
        await joinWaitlist(await operations.getSignupConfig(), { email, note });
        return { success: true as const };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('waitlist:join failed', { error: message });
        return { success: false as const, error: message };
      }
    },
  });
}
