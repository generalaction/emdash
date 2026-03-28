import { AddProjectModal } from '@renderer/components/add-project-modal/add-project-modal';
import { AddSshConnModal } from '@renderer/components/add-ssh-conn-modal/add-ssh-conn-modal';
import { CommandPaletteModal } from '@renderer/components/cmdk/CommandPaletteModal';
import { ConfirmActionDialog } from '@renderer/components/confirm-action-dialog';
import { GithubDeviceFlowModalOverlay } from '@renderer/components/github-device-flow-modal';
import { McpModal } from '@renderer/components/mcp/McpModal';
import { UpdateModalOverlay } from '@renderer/components/updates/UpdateModal';
import { CreateConversationModal } from '@renderer/core/conversations/create-conversation-modal';
import { NewProjectModal } from '@renderer/core/projects/new-project-modal';
import { CreateTaskModal } from '@renderer/core/tasks/create-task-modal/create-task-modal';
import { CreatePrModal } from '@renderer/views/tasks/diff-viewer/right-panel/pr-section/create-pr-modal';
import { ConflictDialog } from '@renderer/views/tasks/editor/conflict-dialog';
import { RenameTaskModal } from '@renderer/views/tasks/rename-task-modal';
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
  confirmActionModal: ConfirmActionDialog,
  createConversationModal: CreateConversationModal,
  mcpServerModal: McpModal,
  conflictDialog: ConflictDialog,
  createPrModal: CreatePrModal,
  renameTaskModal: RenameTaskModal,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<string, ModalComponent<any, any>>;
