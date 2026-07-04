import { err, type Result } from '@main/lib/result';
import type {
  LoopSessionDriver,
  LoopSessionDriverError,
  LoopSessionInfo,
  PromptResult,
  StartPhaseSessionContext,
} from './session-driver';

function notImplemented(): Result<never, LoopSessionDriverError> {
  return err({
    kind: 'not-implemented',
    message: 'PTY loop sessions are not implemented yet. ACP is the current loop driver.',
  });
}

export const ptyLoopSessionDriver: LoopSessionDriver = {
  kind: 'pty',

  async startPhaseSession(
    _ctx: StartPhaseSessionContext
  ): Promise<Result<LoopSessionInfo, LoopSessionDriverError>> {
    return notImplemented();
  },

  async sendPrompt(
    _conversationId: string,
    _text: string
  ): Promise<Result<PromptResult, LoopSessionDriverError>> {
    return notImplemented();
  },

  async cancelPrompt(_conversationId: string): Promise<Result<void, LoopSessionDriverError>> {
    return notImplemented();
  },
};
