import { IntegrationSetupModal } from '../browser/integration-setup-modal';

export const integrationsBrowserContributions = {
  modals: {
    integrationSetupModal: {
      component: IntegrationSetupModal,
      size: 'md',
    },
  },
} as const;
