import type { Result } from '@main/lib/result';
import type { LoopSessionPurpose, LoopSessionTarget } from '@shared/core/loops/loop-state';
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
  purpose: Extract<LoopSessionPurpose, 'work' | 'review'>;
  target: LoopSessionTarget;
  taskEnvironment: Readonly<Record<string, string>>;
  conversationId?: string;
};

export type StartVerificationSessionContext = {
  loop: Loop;
  phase: LoopPhase;
  purpose: Extract<LoopSessionPurpose, 'browser-verification' | 'e2e'>;
  target: LoopSessionTarget;
  taskEnvironment: Readonly<Record<string, string>>;
  conversationId?: string;
};

export type RestartVerificationSessionContext = Omit<
  StartVerificationSessionContext,
  'conversationId'
> & {
  conversationId: string;
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
  /** Restarts the same persisted verification conversation after a cancelled provider turn. */
  restartVerificationSession?(
    ctx: RestartVerificationSessionContext
  ): Promise<Result<LoopSessionInfo, LoopSessionDriverError>>;
  sendPrompt(
    conversationId: string,
    text: string
  ): Promise<Result<PromptResult, LoopSessionDriverError>>;
  cancelPrompt(conversationId: string): Promise<Result<void, LoopSessionDriverError>>;
}

export function phaseConversationTitle(
  loop: Loop,
  phase: LoopPhase,
  purpose: 'work' | 'review'
): string {
  return `${loop.slug}-${phase.idx + 1}${purpose === 'review' ? '-review' : ''}`;
}

export function verificationConversationTitle(
  loop: Loop,
  phase: LoopPhase,
  purpose: 'browser-verification' | 'e2e'
): string {
  return `${loop.slug}-${phase.idx + 1}-${purpose === 'e2e' ? 'e2e' : 'verify'}`;
}
