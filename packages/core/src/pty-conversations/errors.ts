import { err, type Result } from '@emdash/shared';
import type { PtyAgentError } from './api/schemas';

export type PtyAgentResult<T> = Result<T, PtyAgentError>;

export const ptyErr = {
  unknownProvider(providerId: string): PtyAgentResult<never> {
    return err({ type: 'unknown-provider', providerId });
  },

  noCommand(providerId: string): PtyAgentResult<never> {
    return err({ type: 'no-command', providerId });
  },

  notFound(conversationId: string): PtyAgentResult<never> {
    return err({ type: 'not-found', conversationId });
  },

  resumeUnsupported(providerId: string): PtyAgentResult<never> {
    return err({ type: 'resume-unsupported', providerId });
  },

  spawnFailed(message: string): PtyAgentResult<never> {
    return err({ type: 'spawn-failed', message });
  },
};
