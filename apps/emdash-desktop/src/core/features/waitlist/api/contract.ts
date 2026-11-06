import { defineContract, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';

export type WaitlistJoinResult = { success: true } | { success: false; error: string };

export const waitlistDomain = 'waitlist' as const;

export const waitlistContract = defineContract({
  join: procedure({
    input: z.object({ email: z.string(), note: z.string() }),
    output: z.custom<WaitlistJoinResult>(),
  }),
});
