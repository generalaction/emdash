import type {
  IntegrationAuthDescriptor,
  IntegrationCredentials,
  IntegrationPluginDefinition,
} from '@emdash/plugins/integrations';
import { defineContract, procedure } from '@emdash/wire';
import { z } from 'zod';
import type { IssueProviderCapabilities } from '@core/primitives/issue-providers/api';

export type IntegrationListItem = {
  id: string;
  name: string;
  description: string;
  websiteUrl: string;
  features: string[];
  disconnectCredentialLabel?: string;
  capabilities: IssueProviderCapabilities;
  auth: IntegrationAuthDescriptor;
  icon: IntegrationPluginDefinition['assets']['icon'];
};

type ConnectResult =
  | { success: true; displayName?: string; displayDetail?: string }
  | { success: false; error: string };
type DisconnectResult = { success: boolean; error?: string };

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
});
