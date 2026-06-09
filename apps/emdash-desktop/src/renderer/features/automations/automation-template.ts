import type { LucideIcon } from 'lucide-react';
import type { TriggerConfig } from '@shared/core/automations/config';

export type BuiltinAutomationTemplate = {
  id: string;
  category: string;
  name: string;
  description: string;
  icon: LucideIcon;
  defaultTrigger: TriggerConfig;
  defaultConversationConfig: {
    initialPrompt: string;
  };
};
