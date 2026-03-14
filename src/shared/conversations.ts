import { ProviderId } from '@shared/agent-provider-registry';

export type Conversation = {
  id: string;
  projectId: string;
  taskId: string;
  providerId: ProviderId;
  title: string;
  resume?: boolean;
  autoApprove?: boolean;
};

export type CreateConversationParams = {
  id?: string;
  projectId: string;
  taskId: string;
  provider: ProviderId;
  title?: string;
  autoApprove?: boolean;
  initialSize?: { cols: number; rows: number };
  initialPrompt?: string;
};
