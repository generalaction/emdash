import type { ConversationConfig, TriggerConfig, StoredAutomationTaskConfig } from './config';

export type Automation = {
  id: string;
  projectId?: string;
  name: string;
  triggerConfig?: TriggerConfig;
  conversationConfig?: ConversationConfig;
  taskConfig?: StoredAutomationTaskConfig;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type CreateAutomationParams = {
  name: string;
  triggerConfig: TriggerConfig;
  conversationConfig: ConversationConfig;
  taskConfig?: StoredAutomationTaskConfig;
  projectId: string;
  enabled?: boolean;
};

export type UpdateAutomationSettingsPatch = {
  projectId?: string;
  triggerConfig?: TriggerConfig;
  conversationConfig?: ConversationConfig;
  taskConfig?: StoredAutomationTaskConfig | null;
};
