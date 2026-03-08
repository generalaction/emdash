export type Conversation = {
  id: string;
  taskId: string;
  title: string;
  provider: string | null;
  isMain: boolean;
  displayOrder: number;
  agentSessionId: string | null;
  type: 'agent' | 'shell';
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
};
