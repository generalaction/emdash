import type {
  IntegrationAuthDescriptor,
  IntegrationCredentials,
  IntegrationPluginDefinition,
} from '@emdash/plugins/integrations';
import { defineContract, eventStream, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import type { IssueProviderCapabilities } from '@core/primitives/issue-providers/api';
import type { ProviderAccountsByProvider } from '@core/primitives/provider-accounts/api';

export type IntegrationProviderDescriptor = {
  id: string;
  name: string;
  description: string;
  websiteUrl: string;
  features: string[];
  disconnectCredentialLabel?: string;
  issueCapabilities: IssueProviderCapabilities;
  auth: IntegrationAuthDescriptor;
  icon: IntegrationPluginDefinition['assets']['icon'];
};

type ConnectResult =
  | { success: true; accountId: string; displayName?: string; displayDetail?: string }
  | { success: false; error: string };
type DisconnectResult = { success: boolean; error?: string };

export type IntegrationConnectOptions = {
  accountId?: string;
  displayName?: string;
};

export const integrationsDomain = 'integrations' as const;

export const integrationsContract = defineContract({
  listProviders: procedure({
    input: z.void(),
    output: z.array(z.custom<IntegrationProviderDescriptor>()),
  }),
  listAccounts: procedure({
    input: z.void(),
    output: z.custom<ProviderAccountsByProvider>(),
  }),
  connect: procedure({
    input: z.object({
      integrationId: z.string(),
      credentials: z.custom<IntegrationCredentials>(),
      accountId: z.string().min(1).optional(),
      displayName: z.string().trim().min(1).optional(),
    }),
    output: z.custom<ConnectResult>(),
  }),
  disconnect: procedure({
    input: z.object({ integrationId: z.string(), accountId: z.string().min(1) }),
    output: z.custom<DisconnectResult>(),
  }),
  setDefaultAccount: procedure({
    input: z.object({ integrationId: z.string(), accountId: z.string() }),
    output: z.custom<DisconnectResult>(),
  }),
  events: eventStream({
    key: z.void(),
    event: z.object({ type: z.literal('accounts-changed'), providerId: z.string() }),
  }),
});
