import type { WaitlistOperations } from '@core/features/waitlist/node/wire-controller';
import { appService } from '@main/core/app/service';
import { env } from '@main/lib/env';

const DEFAULT_WAITLIST_API_URL = 'https://emdash.com/api/waitlist';

export const waitlistOperations: WaitlistOperations = {
  async getSignupConfig() {
    return {
      apiUrl:
        env.dev.WAITLIST_API_URL || env.build.VITE_WAITLIST_API_URL || DEFAULT_WAITLIST_API_URL,
      source: `desktop app v${await appService.getCachedAppVersion()}`,
    };
  },
};
