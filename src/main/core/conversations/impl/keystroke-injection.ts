import { getProvider } from '@shared/agent-provider-registry';
import type { Conversation } from '@shared/conversations';
import { buildPromptInjectionPayload } from '@shared/prompt-injection';
import type { Pty } from '@main/core/pty/pty';
import { log } from '@main/lib/logger';

const INITIAL_PROMPT_INJECTION_DELAY_MS = 1000;

export function scheduleInitialPromptInjection(args: {
  pty: Pty;
  conversation: Conversation;
  initialPrompt: string | undefined;
  isResuming: boolean;
}): void {
  if (args.isResuming) return;
  if (!args.initialPrompt?.trim()) return;

  const provider = getProvider(args.conversation.providerId);
  if (!provider?.useKeystrokeInjection) return;

  const payload = buildPromptInjectionPayload({
    providerId: args.conversation.providerId,
    text: args.initialPrompt,
  });
  if (!payload) return;

  setTimeout(() => {
    try {
      args.pty.write(`${payload}\r`);
    } catch (error) {
      log.warn('ConversationProvider: failed to inject initial prompt', {
        providerId: args.conversation.providerId,
        conversationId: args.conversation.id,
        error: String(error),
      });
    }
  }, INITIAL_PROMPT_INJECTION_DELAY_MS);
}
