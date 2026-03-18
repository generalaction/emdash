import { AddProjectModal } from '@renderer/components/add-project-modal/add-project-modal';
import { AddSshConnModal } from '@renderer/components/add-ssh-conn-modal/add-ssh-conn-modal';
import { CommandPaletteModal } from '@renderer/components/CommandPaletteModal';
import { ConfirmActionDialog } from '@renderer/components/ConfirmActionDialog';
import { GithubDeviceFlowModalOverlay } from '@renderer/components/GithubDeviceFlowModal';
import { McpModal } from '@renderer/components/mcp/McpModal';
import { NewProjectModal } from '@renderer/components/NewProjectModal';
import { ProjectSettingsModal } from '@renderer/components/project-settings-modal/ProjectSettingsModal';
import { UpdateModalOverlay } from '@renderer/components/UpdateModal';
import { CreateConversationModal } from '@renderer/features/conversations/create-conversation-modal';
import { CreateTaskModal } from '@renderer/views/projects/create-task-modal';
import { ModalComponent } from './modal-provider';

// Define overlays here so we can use them in the showOverlay function
export const modalRegistry = {
  updateModal: UpdateModalOverlay,
  newProjectModal: NewProjectModal,
  taskModal: CreateTaskModal,
  addProjectModal: AddProjectModal,
  addSshConnModal: AddSshConnModal,
  githubDeviceFlowModal: GithubDeviceFlowModalOverlay,
  commandPaletteModal: CommandPaletteModal,
  projectSettingsModal: ProjectSettingsModal,
  confirmActionModal: ConfirmActionDialog,
  createConversationModal: CreateConversationModal,
  mcpServerModal: McpModal,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<string, ModalComponent<any, any>>;
