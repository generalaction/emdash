import type {
  AcpProcessHost,
  AcpStartInputWire,
  PromptAttachment,
  PromptInput,
} from '@emdash/core/acp';
import type {
  AgentHostAcpSpawn,
  AgentHostError,
  ResolvedAcpProvider,
} from '@emdash/core/agents/plugins';
import type { Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import type { AttachmentStore } from './attachment-store';

export type AcpStartInput = AcpStartInputWire;

export type ResolveAcpProvider = (providerId: string) => ResolvedAcpProvider | null;

/** Minimal provider surface required by the ACP runtime. */
export interface AcpAgentHost {
  resolveAcp(providerId: string): ResolvedAcpProvider | null;
  buildAcpSpawn(
    providerId: string,
    ctx: { cwd: string; env?: Record<string, string> }
  ): Promise<Result<AgentHostAcpSpawn, AgentHostError>>;
}

export interface ResolvedPromptAttachment {
  data: string;
  mimeType: string;
}

export type ResolvePromptAttachment = (
  attachment: PromptAttachment
) => Promise<ResolvedPromptAttachment>;

export type AcpRuntimeProcessHost = Omit<AcpProcessHost, 'resolveSpawnContext'>;

export interface AcpRuntimeDeps {
  agentHost: AcpAgentHost;
  host: AcpRuntimeProcessHost;
  resolveAttachment: ResolvePromptAttachment;
  attachmentStore?: AttachmentStore;
  logger: Logger;
}

export interface SendPromptInput {
  conversationId: string;
  prompt: PromptInput;
}
