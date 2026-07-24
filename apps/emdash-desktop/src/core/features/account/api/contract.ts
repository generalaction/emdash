import { defineContract, procedure } from '@emdash/wire';
import { z } from 'zod';

type AccountUser = {
  userId: string;
  name?: string;
  username: string;
  avatarUrl: string;
  email: string;
};

type ProviderAccount = {
  providerId: string;
  providerAccountId: string;
  host: string;
  login: string;
  avatarUrl: string;
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
  providerAccount?: ProviderAccount;
  code?: string;
  error?: string;
};

export const accountContract = defineContract({
  getSession: procedure({ input: z.void(), output: z.custom<AccountSession>() }),
  signIn: procedure({
    input: z.object({ provider: z.string().optional() }),
    output: z.custom<AccountResult>(),
  }),
  linkProviderAccount: procedure({
    input: z.object({ provider: z.string().optional() }),
    output: z.custom<AccountResult>(),
  }),
  signOut: procedure({ input: z.void(), output: z.custom<AccountResult>() }),
  checkHealth: procedure({ input: z.void(), output: z.boolean() }),
});
