import type { Logger } from '@emdash/shared/logger';
import type { AcpAgentApi } from '../../agents/plugins/capabilities/acp';
import type { PromptAttachment } from '../models/attachments';
import type { QueuedPrompt } from '../models/prompt';

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
