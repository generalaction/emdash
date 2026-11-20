import { addMachineModal } from '../browser/add-machine-modal';
import { linkConversationModal } from '../browser/components/link-conversation-modal';
import { workspaceCleanupModal } from '../browser/components/workspace-cleanup-dialog';

export const machinesBrowserContributions = {
  modalDefs: [addMachineModal, linkConversationModal, workspaceCleanupModal],
} as const;
