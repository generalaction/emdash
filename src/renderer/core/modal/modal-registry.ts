import { AddProjectModal } from '@renderer/components/add-project-modal/add-project-modal';
import { AddSshConnModal } from '@renderer/components/add-ssh-conn-modal/add-ssh-conn-modal';
import { CommandPaletteModal } from '@renderer/components/cmdk/CommandPaletteModal';
import { ConfirmActionDialog } from '@renderer/components/confirm-action-dialog';
import { FeedbackModal } from '@renderer/components/feedback-modal';
import { GithubDeviceFlowModalOverlay } from '@renderer/components/github-device-flow-modal';
import { McpModal } from '@renderer/components/mcp/McpModal';
import { UpdateModalOverlay } from '@renderer/components/updates/UpdateModal';
import { CreateConversationModal } from '@renderer/core/conversations/create-conversation-modal';
import { IntegrationSetupModal } from '@renderer/core/integrations/integration-setup-modal';
import { NewProjectModal } from '@renderer/core/projects/new-project-modal';
import { CreateTaskModal } from '@renderer/core/tasks/create-task-modal/create-task-modal';
import { CreatePrModal } from '@renderer/views/tasks/diff-view/changes-panel/pr-section/create-pr-modal';
import { ConflictDialog } from '@renderer/views/tasks/editor/conflict-dialog';
import { RenameTaskModal } from '@renderer/views/tasks/rename-task-modal';
import { ModalComponent } from './modal-provider';

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
  newProjectModal: { component: NewProjectModal, popupClassName: 'max-w-md' },
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
} satisfies Record<string, ModalRegistryEntry>;
