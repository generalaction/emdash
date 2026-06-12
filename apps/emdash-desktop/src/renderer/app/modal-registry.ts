import { CommandPaletteModal } from '@renderer/features/command-palette/command-palette-modal';
import { IntegrationSetupModal } from '@renderer/features/integrations/integration-setup-modal';
import { PromptFolderModal } from '@renderer/features/library/prompts/prompt-folder-modal';
import { PromptModal } from '@renderer/features/library/prompts/prompt-modal';
import { McpModal } from '@renderer/features/mcp/components/McpModal';
import { AddProjectModal } from '@renderer/features/projects/components/add-project-modal/add-project-modal';
import { ProjectConfigImportModal } from '@renderer/features/projects/components/settings-view/project-config-import-modal';
import { ShareProjectConfigModal } from '@renderer/features/projects/components/settings-view/share-project-config-modal';
import { GithubConnectModal } from '@renderer/features/settings/components/github-connect-modal';
import { CreateSkillModal } from '@renderer/features/skills/components/CreateSkillModal';
import { AddRemoteModal } from '@renderer/features/tasks/add-remote-modal';
import { CreateConversationModal } from '@renderer/features/tasks/conversations/create-conversation-modal';
import { CreateTaskModal } from '@renderer/features/tasks/create-task-modal/create-task-modal';
import { DeleteTaskModal } from '@renderer/features/tasks/delete-task-modal';
import { CreatePrModal } from '@renderer/features/tasks/diff-view/changes-panel/components/pr-entry/create-pr-modal';
import { ConflictDialog } from '@renderer/features/tasks/editor/conflict-dialog';
import { RenameTaskModal } from '@renderer/features/tasks/rename-task-modal';
import { AddSshConnModal } from '@renderer/lib/components/add-ssh-conn-modal';
import { ChangeProjectConnectionModal } from '@renderer/lib/components/change-project-connection-modal';
import { ConfirmActionDialog } from '@renderer/lib/components/confirm-action-dialog';
import { ExternalLinkChoiceDialog } from '@renderer/lib/components/external-link-choice-dialog';
import { FeedbackModal } from '@renderer/lib/components/feedback-modal/feedback-modal';
import { GithubDeviceFlowModal } from '@renderer/lib/components/github-device-flow-modal';
import { UnsavedChangesDialog } from '@renderer/lib/components/unsaved-changes-dialog';
import { type ModalComponent } from '@renderer/lib/modal/modal-provider';

export type ModalSize = 'xs' | 'sm' | 'md' | 'lg';
export type ModalPosition = 'center' | 'top';

export type ModalRegistryEntry<TProps = unknown, TResult = unknown> = {
  component: ModalComponent<TProps, TResult>;
  size?: ModalSize;
  position?: ModalPosition;
};

export function createModal<TProps, TResult>(
  component: ModalComponent<TProps, TResult>,
  config: Omit<ModalRegistryEntry, 'component'> = {}
): ModalRegistryEntry<TProps, TResult> {
  return { component, ...config };
}

export const modalRegistry = {
  commandPaletteModal: createModal(CommandPaletteModal, { size: 'md' }),
  taskModal: createModal(CreateTaskModal),
  addProjectModal: createModal(AddProjectModal),
  addSshConnModal: createModal(AddSshConnModal),
  changeProjectConnectionModal: createModal(ChangeProjectConnectionModal, { size: 'sm' }),
  githubDeviceFlowModal: createModal(GithubDeviceFlowModal, { size: 'md' }),
  confirmActionModal: createModal(ConfirmActionDialog, { size: 'xs' }),
  confirmExternalLinkModal: createModal(ExternalLinkChoiceDialog, { size: 'sm' }),
  unsavedChangesModal: createModal(UnsavedChangesDialog, { size: 'xs' }),
  createConversationModal: createModal(CreateConversationModal),
  feedbackModal: createModal(FeedbackModal),
  promptModal: createModal(PromptModal, { size: 'lg' }),
  promptFolderModal: createModal(PromptFolderModal, { size: 'xs' }),
  mcpServerModal: createModal(McpModal),
  createSkillModal: createModal(CreateSkillModal),
  conflictDialog: createModal(ConflictDialog, { size: 'sm' }),
  createPrModal: createModal(CreatePrModal, { size: 'md' }),
  renameTaskModal: createModal(RenameTaskModal, { size: 'xs' }),
  shareProjectConfigModal: createModal(ShareProjectConfigModal, { size: 'md' }),
  projectConfigImportModal: createModal(ProjectConfigImportModal, { size: 'md' }),
  integrationSetupModal: createModal(IntegrationSetupModal, { size: 'md' }),
  githubConnectModal: createModal(GithubConnectModal, { size: 'md' }),
  addRemoteModal: createModal(AddRemoteModal),
  deleteTaskModal: createModal(DeleteTaskModal, { size: 'sm' }),
  // oxlint-disable-next-line typescript/no-explicit-any
} satisfies Record<string, ModalRegistryEntry<any, any>>;
