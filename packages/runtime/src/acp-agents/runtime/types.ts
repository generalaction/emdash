import type {
  AcpProcessHost,
  AcpStartInputWire,
  PromptAttachment,
  PromptInput,
} from '@emdash/core/acp';
import type { AgentPluginHost, ResolvedAcpProvider } from '@emdash/core/agents/plugins';
import type { Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import type { AttachmentStore } from './attachment-store';

export type AcpStartInput = AcpStartInputWire;

export type ResolveAcpProvider = (providerId: string) => ResolvedAcpProvider | null;

export interface ResolvedPromptAttachment {
  data: string;
  mimeType: string;
}

export type ResolvePromptAttachment = (
  attachment: PromptAttachment
) => Promise<ResolvedPromptAttachment>;

export type SetSessionIdError = { type: string; message?: string };

export type AcpRuntimeProcessHost = Omit<AcpProcessHost, 'resolveSpawnContext'>;

export interface AcpRuntimeDeps {
  agentHost: AgentPluginHost;
  host: AcpRuntimeProcessHost;
  persistSessionId: (
    conversationId: string,
    sessionId: string
  ) => Promise<Result<void, SetSessionIdError>>;
  resolveAttachment: ResolvePromptAttachment;
  attachmentStore?: AttachmentStore;
  logger: Logger;
}

export interface SendPromptInput {
  conversationId: string;
  prompt: PromptInput;
}
