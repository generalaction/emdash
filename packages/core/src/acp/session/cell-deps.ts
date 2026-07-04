import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';
import type { Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import type { AcpAgentApi } from '../../agents/plugins/capabilities/acp';
import type { AcpRuntimeError } from '../errors';
import type { PromptAttachment } from '../models/attachments';
import type { PromptInput, QueuedPrompt } from '../models/prompt';
import type { TranscriptTurnOutcome } from '../models/turns';

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
  onPermissionRequest?: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
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

export interface SessionCell {
  prompt(input: PromptInput): Promise<Result<SessionPromptResult, AcpRuntimeError>>;
  settleTurn(outcome: TranscriptTurnOutcome): void;
}
