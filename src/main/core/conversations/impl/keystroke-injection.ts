import type { Pty } from '@main/core/pty/pty';
import { log } from '@main/lib/logger';
import { getProvider } from '@shared/agent-provider-registry';
import type { Conversation } from '@shared/conversations';
import { buildPromptInjectionPayload } from '@shared/prompt-injection';

// Inject only after the TUI has produced output and stayed idle for a beat;
// fixed delays race the agent's startup (auth, sync, model load).
const QUIET_PERIOD_MS = 800;
const MAX_WAIT_MS = 15_000;

function shouldWaitForPromptReadiness(conversation: Conversation, isResuming: boolean): boolean {
  if (isResuming) return false;
  return getProvider(conversation.providerId)?.useKeystrokeInjection === true;
}

function scheduleWhenReadyForPrompt(args: {
  pty: Pty;
  conversation: Conversation;
  isResuming: boolean;
  force?: boolean;
  onReady: () => void;
  onExitBeforeReady: (sawAnyOutput: boolean) => void;
}): void {
  if (!args.force && !shouldWaitForPromptReadiness(args.conversation, args.isResuming)) {
    args.onReady();
    return;
  }

  let ready = false;
  let sawAnyOutput = false;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;

  const markReady = () => {
    if (ready) return;
    ready = true;
    if (quietTimer) clearTimeout(quietTimer);
    clearTimeout(maxWaitTimer);
    args.onReady();
  };

  const maxWaitTimer = setTimeout(markReady, MAX_WAIT_MS);

  args.pty.onData(() => {
    if (ready) return;
    sawAnyOutput = true;
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(markReady, QUIET_PERIOD_MS);
  });

  args.pty.onExit(() => {
    const wasReady = ready;
    ready = true;
    if (quietTimer) clearTimeout(quietTimer);
    clearTimeout(maxWaitTimer);
    if (!wasReady) {
      args.onExitBeforeReady(sawAnyOutput);
    }
  });
}

export function waitForInitialPromptReadiness(args: {
  pty: Pty;
  conversation: Conversation;
  isResuming: boolean;
  force?: boolean;
}): Promise<void> {
  return new Promise((resolve) => {
    scheduleWhenReadyForPrompt({
      ...args,
      onReady: resolve,
      onExitBeforeReady: (sawAnyOutput) => {
        log.warn('ConversationProvider: PTY exited before initial prompt was ready', {
          providerId: args.conversation.providerId,
          conversationId: args.conversation.id,
          sawAnyOutput,
        });
        resolve();
      },
    });
  });
}

export function scheduleInitialPromptInjection(args: {
  pty: Pty;
  conversation: Conversation;
  initialPrompt: string | undefined;
  isResuming: boolean;
}): void {
  if (!args.initialPrompt?.trim()) return;

  const payload = buildPromptInjectionPayload({
    providerId: args.conversation.providerId,
    text: args.initialPrompt,
  });

  scheduleWhenReadyForPrompt({
    pty: args.pty,
    conversation: args.conversation,
    isResuming: args.isResuming,
    onReady: () => {
      if (!shouldWaitForPromptReadiness(args.conversation, args.isResuming)) return;
      try {
        args.pty.write(`${payload}\r`);
      } catch (error) {
        log.warn('ConversationProvider: failed to inject initial prompt', {
          providerId: args.conversation.providerId,
          conversationId: args.conversation.id,
          error: String(error),
        });
      }
    },
    onExitBeforeReady: (sawAnyOutput) => {
      log.warn('ConversationProvider: PTY exited before initial prompt could be injected', {
        providerId: args.conversation.providerId,
        conversationId: args.conversation.id,
        sawAnyOutput,
      });
    },
  });
}
