import type { WaitlistOperations } from '@core/features/waitlist/node/wire-controller';
import { appService } from '@main/core/app/service';
import { env } from '@main/lib/env';

export const waitlistOperations: WaitlistOperations = {
  async getSignupConfig() {
    return {
      url: env.dev.WAITLIST_SUPABASE_URL ?? env.build.VITE_WAITLIST_SUPABASE_URL,
      anonKey: env.dev.WAITLIST_SUPABASE_ANON_KEY ?? env.build.VITE_WAITLIST_SUPABASE_ANON_KEY,
      source: `desktop app v${await appService.getCachedAppVersion()}`,
    };
  },
};
