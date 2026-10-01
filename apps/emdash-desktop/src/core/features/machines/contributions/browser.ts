import { addMachineModal } from '../browser/add-machine-modal';
import { linkConversationModal } from '../browser/components/link-conversation-modal';
import { hostTrustModal } from '../browser/host-trust-modal';

export const machinesBrowserContributions = {
  modalDefs: [addMachineModal, linkConversationModal, hostTrustModal],
} as const;
