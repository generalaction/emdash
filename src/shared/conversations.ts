import type { AgentProviderId } from '@shared/agent-provider-registry';

export const INITIAL_PROMPT_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const RENDERER_FILE_MAX_BYTES = 100 * 1024 * 1024;

export type Conversation = {
  id: string;
  projectId: string;
  taskId: string;
  providerId: AgentProviderId;
  title: string;
  resume?: boolean;
  autoApprove?: boolean;
};

export type RenameConversationParams = {
  conversationId: string;
  newTitle: string;
};

export type CreateConversationParams = {
  id: string;
  projectId: string;
  taskId: string;
  provider: AgentProviderId;
  title: string;
  autoApprove?: boolean;
  initialSize?: { cols: number; rows: number };
  initialPrompt?: string;
  initialPromptImages?: Array<{ name: string; path: string }>;
};
