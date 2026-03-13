import { ProviderId } from '@shared/providers/registry';

export type Conversation = {
  id: string;
  projectId: string;
  taskId: string;
  providerId: ProviderId;
  title: string;
  resume?: boolean;
  autoApprove?: boolean;
};
