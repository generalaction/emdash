export type ConversationModelOption = {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
};

export type ConversationFeatureToggle = {
  type: 'toggle';
  id: string;
  label: string;
  description?: string;
  value: boolean;
};

export type ConversationControls = {
  selectedModelId?: string;
  models: ConversationModelOption[];
  features: ConversationFeatureToggle[];
};
