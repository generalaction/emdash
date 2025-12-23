import type { ProviderId } from '@shared/providers/registry';

/**
 * Repository-specific settings for branch management
 */
export interface RepositorySettings {
  /** Git branch template using {slug} and {timestamp} placeholders */
  branchTemplate: string;
  /** Whether to push to remote after creating a branch */
  pushOnCreate: boolean;
}

/**
 * Application-wide settings that persist across app restarts
 */
export interface AppSettings {
  /** Repository and branch management settings */
  repository: RepositorySettings;

  /** Project preparation settings */
  projectPrep: {
    /** Auto-install dependencies when opening project in editor */
    autoInstallOnOpenInEditor: boolean;
  };

  /** In-app browser preview settings */
  browserPreview?: {
    /** Whether browser preview is enabled */
    enabled: boolean;
    /** Browser engine to use for preview */
    engine: 'chromium';
  };

  /** Notification settings */
  notifications?: {
    /** Whether notifications are enabled */
    enabled: boolean;
    /** Whether sound is enabled for notifications */
    sound: boolean;
  };

  /** Model Context Protocol (MCP) settings */
  mcp?: {
    context7?: {
      /** Whether Context7 integration is enabled */
      enabled: boolean;
      /** Dismissed installation hints keyed by provider ID */
      installHintsDismissed?: Record<string, boolean>;
    };
  };

  /** Default AI provider to use for new tasks */
  defaultProvider?: ProviderId;

  /** Task/workspace settings */
  tasks?: {
    /** Whether to auto-generate task names from AI responses */
    autoGenerateName: boolean;
    /** Whether auto-approve is enabled by default for new tasks */
    autoApproveByDefault: boolean;
  };

  /** Project management settings */
  projects?: {
    /** Default directory for new projects */
    defaultDirectory: string;
  };

  /** Feature flag settings */
  features?: {
    kanban?: {
      /** Whether the Kanban board feature is enabled */
      enabled: boolean;
    };
  };
}

/**
 * Type for partial settings updates - allows partial updates at all nesting levels
 * All nested properties are optional to support granular updates
 */
export type AppSettingsUpdate = {
  repository?: { branchTemplate?: string; pushOnCreate?: boolean };
  projectPrep?: { autoInstallOnOpenInEditor?: boolean };
  browserPreview?: { enabled?: boolean; engine?: 'chromium' };
  notifications?: { enabled?: boolean; sound?: boolean };
  mcp?: {
    context7?: {
      enabled?: boolean;
      installHintsDismissed?: Record<string, boolean>;
    };
  };
  defaultProvider?: string;
  tasks?: {
    autoGenerateName?: boolean;
    autoApproveByDefault?: boolean;
  };
  projects?: {
    defaultDirectory?: string;
  };
  features?: {
    kanban?: {
      enabled?: boolean;
    };
  };
};
