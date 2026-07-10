import type { PromptAttachment, QueuedPrompt } from '@emdash/core/acp';
import type { AcpAgentApi } from '@emdash/core/agents/plugins';
import type { Logger } from '@emdash/shared/logger';

export interface ResolvedPromptAttachment {
  data: string;
  mimeType: string;
}

export type ResolvePromptAttachment = (
  attachment: PromptAttachment
) => Promise<ResolvedPromptAttachment>;

export interface SessionCellCallbacks {
  onSessionStateChanged?: () => void;
  onTranscriptChanged?: () => void;
  onDraftChanged?: () => void;
  onClosed?: (exitCode: number | null) => void;
  onAgentEvent?: (phase: 'start' | 'stop' | 'error') => void;
  onSendQueuedPrompt?: (prompt: QueuedPrompt) => void;
}

export interface SessionCellDeps {
  conversationId: string;
  projectId: string;
  taskId: string;
  providerId: string;
  acpSessionId: string;
  agent: AcpAgentApi;
  resolveAttachment: ResolvePromptAttachment;
  logger: Logger;
  callbacks?: SessionCellCallbacks;
}

export interface SessionPromptResult {
  queued: boolean;
}
