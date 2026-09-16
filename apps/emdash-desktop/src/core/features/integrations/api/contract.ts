import type {
  IntegrationAuthDescriptor,
  IntegrationCredentials,
  IntegrationPluginDefinition,
} from '@emdash/plugins/integrations';
import { defineContract, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import type {
  IntegrationAccountSummary,
  IntegrationRemoveAccountResponse,
  IntegrationSetDefaultAccountResponse,
} from '@core/primitives/integrations/api';
import type { IssueProviderCapabilities } from '@core/primitives/issue-providers/api';

export type IntegrationListItem = {
  id: string;
  name: string;
  description: string;
  websiteUrl: string;
  features: string[];
  supportsMultipleAccounts: boolean;
  disconnectCredentialLabel?: string;
  capabilities: IssueProviderCapabilities;
  auth: IntegrationAuthDescriptor;
  icon: IntegrationPluginDefinition['assets']['icon'];
};

type ConnectResult =
  | {
      success: true;
      displayName?: string;
      displayDetail?: string;
      accountId: string;
      providerAccountStatus: 'created' | 'updated';
    }
  | { success: false; error: string };
type DisconnectResult = { success: boolean; error?: string };

export const integrationsDomain = 'integrations' as const;

export const integrationsContract = defineContract({
  list: procedure({ input: z.void(), output: z.array(z.custom<IntegrationListItem>()) }),
  connect: procedure({
    input: z.object({
      integrationId: z.string(),
      credentials: z.custom<IntegrationCredentials>(),
    }),
    output: z.custom<ConnectResult>(),
  }),
  disconnect: procedure({
    input: z.object({ integrationId: z.string() }),
    output: z.custom<DisconnectResult>(),
  }),
  listAccounts: procedure({
    input: z.object({ integrationId: z.string() }),
    output: z.array(z.custom<IntegrationAccountSummary>()),
  }),
  setDefaultAccount: procedure({
    input: z.object({ integrationId: z.string(), accountId: z.string().min(1) }),
    output: z.custom<IntegrationSetDefaultAccountResponse>(),
  }),
  removeAccount: procedure({
    input: z.object({ integrationId: z.string(), accountId: z.string().min(1) }),
    output: z.custom<IntegrationRemoveAccountResponse>(),
  }),
});
