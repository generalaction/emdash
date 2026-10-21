import { integrationDeviceFlowModal } from '../browser/integration-device-flow-modal';
import { integrationSetupModal } from '../browser/integration-setup-modal';

export const integrationsBrowserContributions = {
  modalDefs: [integrationSetupModal, integrationDeviceFlowModal],
} as const;
