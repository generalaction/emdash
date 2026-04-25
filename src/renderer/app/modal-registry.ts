import { IntegrationSetupModal } from '@renderer/features/integrations/integration-setup-modal';
import { McpModal } from '@renderer/features/mcp/components/McpModal';
import { AddProjectModal } from '@renderer/features/projects/components/add-project-modal/add-project-modal';
import { CreateSkillModal } from '@renderer/features/skills/components/CreateSkillModal';
import { AddRemoteModal } from '@renderer/features/tasks/add-remote-modal';
import { CreateConversationModal } from '@renderer/features/tasks/conversations/create-conversation-modal';
import { CreateTaskModal } from '@renderer/features/tasks/create-task-modal/create-task-modal';
import { CreatePrModal } from '@renderer/features/tasks/diff-view/changes-panel/components/pr-entry/create-pr-modal';
import { ConflictDialog } from '@renderer/features/tasks/editor/conflict-dialog';
import { RenameTaskModal } from '@renderer/features/tasks/rename-task-modal';
import { AddSshConnModal } from '@renderer/lib/components/add-ssh-conn-modal';
import { ChangeProjectConnectionModal } from '@renderer/lib/components/change-project-connection-modal';
import { ConfirmActionDialog } from '@renderer/lib/components/confirm-action-dialog';
import { FeedbackModal } from '@renderer/lib/components/feedback-modal/feedback-modal';
import { GithubDeviceFlowModalOverlay } from '@renderer/lib/components/github-device-flow-modal';
import { ModalComponent } from '@renderer/lib/modal/modal-provider';

export type ModalSize = 'xs' | 'sm' | 'md' | 'lg';

export type ModalRegistryEntry = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ModalComponent<any, any>;
  size?: ModalSize;
};

export function createModal<TProps, TResult>(
  component: ModalComponent<TProps, TResult>,
  config: Omit<ModalRegistryEntry, 'component'> = {}
): ModalRegistryEntry {
  return { component, ...config };
}

export const modalRegistry = {
  taskModal: createModal(CreateTaskModal),
  addProjectModal: createModal(AddProjectModal),
  addSshConnModal: createModal(AddSshConnModal),
  changeProjectConnectionModal: createModal(ChangeProjectConnectionModal, { size: 'sm' }),
  githubDeviceFlowModal: createModal(GithubDeviceFlowModalOverlay, { size: 'md' }),
  confirmActionModal: createModal(ConfirmActionDialog, { size: 'xs' }),
  createConversationModal: createModal(CreateConversationModal),
  feedbackModal: createModal(FeedbackModal),
  mcpServerModal: createModal(McpModal),
  createSkillModal: createModal(CreateSkillModal),
  conflictDialog: createModal(ConflictDialog, { size: 'sm' }),
  createPrModal: createModal(CreatePrModal, { size: 'md' }),
  renameTaskModal: createModal(RenameTaskModal, { size: 'xs' }),
  integrationSetupModal: createModal(IntegrationSetupModal, { size: 'md' }),
  addRemoteModal: createModal(AddRemoteModal),
} satisfies Record<string, ModalRegistryEntry>;
