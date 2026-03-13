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
