import type { Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import type { IAcpBehavior } from '../../agents/plugins/capabilities/acp';
import type { AgentAuthStatus } from '../../agents/plugins/capabilities/auth';
import type { PromptAttachment } from '../models/attachments';
import type { PromptInput } from '../models/prompt';
import type { AcpProcessHost } from '../transport';
import type { AttachmentStore } from './attachment-store';

export interface AcpStartInput {
  conversationId: string;
  projectId: string;
  taskId: string;
  providerId: string;
  workspaceId: string;
  cwd: string;
  sessionId: string | null;
  model: string | null;
  initialQueue?: PromptInput[];
}

export interface ResumeSessionInput extends AcpStartInput {
  sessionId: string;
}

export type ResolveAcpProvider = (providerId: string) => { behavior: IAcpBehavior } | null;

export interface ResolvedPromptAttachment {
  data: string;
  mimeType: string;
}

export type ResolvePromptAttachment = (
  attachment: PromptAttachment
) => Promise<ResolvedPromptAttachment>;

export type SetSessionIdError = { type: string; message?: string };

export interface AcpRuntimeDeps {
  resolveAcp: ResolveAcpProvider;
  host: AcpProcessHost;
  persistSessionId: (
    conversationId: string,
    sessionId: string
  ) => Promise<Result<void, SetSessionIdError>>;
  resolveAttachment: ResolvePromptAttachment;
  checkAuth?: (providerId: string) => Promise<AgentAuthStatus>;
  onAuthRequired?: (providerId: string) => void;
  attachmentStore?: AttachmentStore;
  logger: Logger;
}

export interface SendPromptInput {
  conversationId: string;
  prompt: PromptInput;
}
