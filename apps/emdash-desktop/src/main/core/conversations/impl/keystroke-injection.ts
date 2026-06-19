import { getPlugin } from '@main/core/agents/plugin-registry';
import type { Pty } from '@main/core/pty/pty';
import { log } from '@main/lib/logger';
import type { Conversation } from '@shared/core/conversations/conversations';
import { buildPromptInjectionPayload } from '@shared/prompt-injection';

// Inject only after the TUI has produced output and stayed idle for a beat;
// fixed delays race the agent's startup (auth, sync, model load).
const QUIET_PERIOD_MS = 800;
const MAX_WAIT_MS = 15_000;

export function scheduleInitialPromptInjection(args: {
  pty: Pty;
  conversation: Conversation;
  initialPrompt: string | undefined;
  isResuming: boolean;
}): void {
  if (args.isResuming) return;
  if (!args.initialPrompt?.trim()) return;

  const plugin = getPlugin(args.conversation.providerId);
  const promptDelivery = plugin.capabilities.prompt;
  if (promptDelivery.kind !== 'keystroke') return;

  const submitSequence = promptDelivery.submitSequence ?? '\r';
  const submitDelayMs = promptDelivery.submitDelayMs;

  const payload = buildPromptInjectionPayload({
    providerId: args.conversation.providerId,
    text: args.initialPrompt,
  });

  let injected = false;
  let sawAnyOutput = false;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;

  const inject = () => {
    if (injected) return;
    injected = true;
    if (quietTimer) clearTimeout(quietTimer);
    clearTimeout(maxWaitTimer);
    try {
      if (submitDelayMs) {
        args.pty.write(payload);
        setTimeout(() => args.pty.write(submitSequence), submitDelayMs);
        return;
      }
      args.pty.write(`${payload}${submitSequence}`);
    } catch (error) {
      log.warn('ConversationProvider: failed to inject initial prompt', {
        providerId: args.conversation.providerId,
        conversationId: args.conversation.id,
        error: String(error),
      });
    }
  };

  const maxWaitTimer = setTimeout(inject, MAX_WAIT_MS);

  args.pty.onData(() => {
    if (injected) return;
    sawAnyOutput = true;
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(inject, QUIET_PERIOD_MS);
  });

  args.pty.onExit(() => {
    const promptWasInjected = injected;
    injected = true;
    if (quietTimer) clearTimeout(quietTimer);
    clearTimeout(maxWaitTimer);
    if (!promptWasInjected) {
      log.warn('ConversationProvider: PTY exited before initial prompt could be injected', {
        providerId: args.conversation.providerId,
        conversationId: args.conversation.id,
        sawAnyOutput,
      });
    }
  });
}
