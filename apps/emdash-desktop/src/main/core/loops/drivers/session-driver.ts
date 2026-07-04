import type { Result } from '@main/lib/result';
import type { Loop, LoopPhase } from '@shared/core/loops/loops';

export type LoopSessionKind = 'acp' | 'pty';

export type LoopSessionDriverError =
  | { kind: 'not-implemented'; message: string }
  | { kind: 'create-failed'; message: string }
  | { kind: 'hydrate-failed'; message: string }
  | { kind: 'prompt-failed'; message: string }
  | { kind: 'cancel-failed'; message: string };

export type StartPhaseSessionContext = {
  loop: Loop;
  phase: LoopPhase;
  review: boolean;
};

export type StartVerificationSessionContext = {
  loop: Loop;
  phase: LoopPhase;
};

export type LoopSessionInfo = {
  conversationId: string;
  title: string;
};

export type PromptResult = {
  finalText: string;
};

export interface LoopSessionDriver {
  readonly kind: LoopSessionKind;
  startPhaseSession(
    ctx: StartPhaseSessionContext
  ): Promise<Result<LoopSessionInfo, LoopSessionDriverError>>;
  startVerificationSession(
    ctx: StartVerificationSessionContext
  ): Promise<Result<LoopSessionInfo, LoopSessionDriverError>>;
  sendPrompt(
    conversationId: string,
    text: string
  ): Promise<Result<PromptResult, LoopSessionDriverError>>;
  cancelPrompt(conversationId: string): Promise<Result<void, LoopSessionDriverError>>;
}

export function phaseConversationTitle(loop: Loop, phase: LoopPhase, review: boolean): string {
  return `${loop.slug}-${phase.idx + 1}${review ? '-review' : ''}`;
}

export function verificationConversationTitle(loop: Loop, phase: LoopPhase): string {
  return `${loop.slug}-${phase.idx + 1}-verify`;
}
