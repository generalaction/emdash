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

export type UpdateAutomationPatch = {
  name?: string;
  projectId?: string;
  enabled?: boolean;
  triggerConfig?: TriggerConfig;
  conversationConfig?: ConversationConfig;
  taskConfig?: StoredAutomationTaskConfig | null;
};

export type BuiltinAutomationTemplate = {
  id: string;
  category: string;
  name: string;
  description: string;
  icon: string;
  defaultTrigger: TriggerConfig;
  defaultConversationConfig: {
    initialPrompt: string;
  };
};
