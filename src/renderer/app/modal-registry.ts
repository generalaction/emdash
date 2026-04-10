import { IntegrationSetupModal } from '@renderer/features/integrations/integration-setup-modal';
import { McpModal } from '@renderer/features/mcp/components/McpModal';
import { AddProjectModal } from '@renderer/features/projects/components/add-project-modal/add-project-modal';
import { AddRemoteModal } from '@renderer/features/tasks/add-remote-modal';
import { CreateConversationModal } from '@renderer/features/tasks/conversations/create-conversation-modal';
import { CreateTaskModal } from '@renderer/features/tasks/create-task-modal/create-task-modal';
import { CreatePrModal } from '@renderer/features/tasks/diff-view/changes-panel/components/pr-entry/create-pr-modal';
import { ConflictDialog } from '@renderer/features/tasks/editor/conflict-dialog';
import { RenameTaskModal } from '@renderer/features/tasks/rename-task-modal';
import { AddSshConnModal } from '@renderer/lib/components/add-ssh-conn-modal';
import { CommandPaletteModal } from '@renderer/lib/components/cmdk/CommandPaletteModal';
import { ConfirmActionDialog } from '@renderer/lib/components/confirm-action-dialog';
import { FeedbackModal } from '@renderer/lib/components/feedback-modal/feedback-modal';
import { GithubDeviceFlowModalOverlay } from '@renderer/lib/components/github-device-flow-modal';
import { UpdateModalOverlay } from '@renderer/lib/components/updates/UpdateModal';
import { ModalComponent } from '@renderer/lib/modal/modal-provider';

export type ModalRegistryEntry = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ModalComponent<any, any>;
  /** Extra classes applied to the persistent Popup for this modal. */
  popupClassName?: string;
  /** When true, the modal manages its own presentation (no persistent Popup shell). */
  usesOwnShell?: boolean;
};

export const modalRegistry = {
  updateModal: { component: UpdateModalOverlay, popupClassName: 'max-w-sm' },
  taskModal: { component: CreateTaskModal },
  addProjectModal: { component: AddProjectModal },
  addSshConnModal: { component: AddSshConnModal },
  githubDeviceFlowModal: {
    component: GithubDeviceFlowModalOverlay,
    popupClassName: 'max-w-[480px] p-0',
  },
  commandPaletteModal: { component: CommandPaletteModal, usesOwnShell: true },
  confirmActionModal: { component: ConfirmActionDialog, popupClassName: 'sm:max-w-xs' },
  createConversationModal: { component: CreateConversationModal },
  feedbackModal: { component: FeedbackModal },
  mcpServerModal: { component: McpModal },
  conflictDialog: { component: ConflictDialog, popupClassName: 'sm:max-w-sm' },
  createPrModal: {
    component: CreatePrModal,
    popupClassName: 'max-h-[70vh] gap-0 sm:max-w-2xl',
  },
  renameTaskModal: { component: RenameTaskModal, popupClassName: 'sm:max-w-xs' },
  integrationSetupModal: { component: IntegrationSetupModal, popupClassName: 'max-w-md' },
  addRemoteModal: { component: AddRemoteModal },
} satisfies Record<string, ModalRegistryEntry>;
