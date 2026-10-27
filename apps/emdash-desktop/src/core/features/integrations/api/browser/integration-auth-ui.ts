import type { IntegrationAuthMethod } from '@emdash/plugins/integrations';
import type { ComponentType } from 'react';
import type { IntegrationProviderDescriptor } from '../contract';

export type IntegrationAuthUiProps = {
  metadata: IntegrationProviderDescriptor;
  accountId?: string;
  displayName?: string;
  onSuccess: () => void;
  onClose: () => void;
};

/** Provider-owned acquisition UI hosted by the shared integration connection flow. */
export type IntegrationAuthUiContribution = {
  integrationId: string;
  methodKinds: IntegrationAuthMethod['kind'][];
  supportsReconnect: boolean;
  component: ComponentType<IntegrationAuthUiProps>;
};
