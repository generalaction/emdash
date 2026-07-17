import type { ConversationConfig, TriggerConfig, StoredAutomationTaskConfig } from './config';

export type AutomationRuntimeAvailability =
  | { available: true }
  | { available: false; reason: string };

export type Automation = {
  id: string;
  projectId?: string;
  name: string;
  triggerConfig?: TriggerConfig;
  conversationConfig?: ConversationConfig;
  taskConfig?: StoredAutomationTaskConfig;
  enabled: boolean;
  revision: number;
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
  enabled?: boolean;
  projectId?: string;
  triggerConfig?: TriggerConfig;
  conversationConfig?: ConversationConfig;
  taskConfig?: StoredAutomationTaskConfig | null;
};
