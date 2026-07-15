import type { Logger } from '@emdash/shared/logger';
import type { Clock } from '@emdash/shared/scheduling';
import type { IdlePolicyConfig } from '@primitives/io-activity/api';
import type {
  AcpProcessHost,
  AcpStartInputWire,
  PromptAttachment,
  PromptInput,
} from '@runtimes/acp/api';
import type { AgentPluginHost, ResolvedAcpProvider } from '@services/agent-plugins/api/plugins';
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

export type AcpRuntimeProcessHost = Omit<AcpProcessHost, 'resolveSpawnContext'>;

export interface AcpRuntimeDeps {
  agentHost: AgentPluginHost;
  host: AcpRuntimeProcessHost;
  resolveAttachment: ResolvePromptAttachment;
  attachmentStore?: AttachmentStore;
  clock?: Clock;
  lifecycle?: {
    session?: IdlePolicyConfig;
    sweepIntervalMs?: number;
    connectionIdleTtlMs?: number;
  };
  logger: Logger;
}

export interface SendPromptInput {
  conversationId: string;
  prompt: PromptInput;
}
