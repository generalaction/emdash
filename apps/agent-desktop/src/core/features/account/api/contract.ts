import { defineContract, procedure } from '@agent/wire/rpc';
import { z } from 'zod';
import type { ProviderAccountIdentity } from '@core/primitives/provider-accounts/api';

type AccountUser = {
  userId: string;
  name?: string;
  username: string;
  avatarUrl: string;
  email: string;
};

type AccountSession = {
  user: AccountUser | null;
  isSignedIn: boolean;
  hasAccount: boolean;
};

type AccountResult = {
  success: boolean;
  user?: AccountUser;
  provider?: string;
  providerAccountStatus?: string;
  providerAccount?: ProviderAccountIdentity;
  code?: string;
  error?: string;
};

export const accountDomain = 'account' as const;

/**
 * Agent accounts are created and signed into only with this provider. Other
 * providers can only be linked to a signed-in Agent account.
 */
export const AGENT_SIGN_IN_PROVIDER = { id: 'github', name: 'GitHub' } as const;

const providerInput = z.object({
  provider: z.string().optional(),
  /** Reconnect this integration account; a token for another identity is not saved. */
  accountId: z.string().min(1).optional(),
});

export const accountContract = defineContract({
  getSession: procedure({ input: z.void(), output: z.custom<AccountSession>() }),
  signIn: procedure({ input: providerInput, output: z.custom<AccountResult>() }),
  linkProviderAccount: procedure({ input: providerInput, output: z.custom<AccountResult>() }),
  signOut: procedure({ input: z.void(), output: z.custom<AccountResult>() }),
  checkHealth: procedure({ input: z.void(), output: z.boolean() }),
});
