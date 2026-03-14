export interface ProviderCustomConfig {
  cli?: string;
  resumeFlag?: string;
  defaultArgs?: string;
  autoApproveFlag?: string;
  initialPromptFlag?: string;
  extraArgs?: string;
  env?: Record<string, string>;
}

export type ProviderCustomConfigs = Record<string, ProviderCustomConfig>;
