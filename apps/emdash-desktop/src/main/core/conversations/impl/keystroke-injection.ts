import type { Pty } from '@main/core/pty/pty';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { getProvider } from '@shared/core/agents/agent-provider-registry';
import { conversationInitialPromptInjectionFailedChannel } from '@shared/core/conversations/conversationEvents';
import type { Conversation } from '@shared/core/conversations/conversations';
import { buildPromptInjectionPayload } from '@shared/prompt-injection';

// Inject only after the TUI has produced output and stayed idle for a beat;
// fixed delays race the agent's startup (auth, sync, model load).
const QUIET_PERIOD_MS = 800;

const KEYSTROKE_READY_OUTPUT: Partial<Record<Conversation['providerId'], RegExp>> = {
  grok: /\b(grok|xai|x\.ai)\b/i,
  hermes: /\bhermes\b/i,
  kimi: /\bkimi\b/i,
  jules: /\bjules\b/i,
  letta: /\bletta\b/i,
};

const SHELL_FAILURE_OUTPUT =
  /(?:^|\n)(?:zsh|bash|sh|fish)(?::\d+)?(?::\s+|\s+)(?:command not found|parse error|no such file or directory)\b/i;
const OUTPUT_BUFFER_MAX = 4096;

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

  const readyOutput = KEYSTROKE_READY_OUTPUT[args.conversation.providerId];
  if (!readyOutput) return;

  const payload = buildPromptInjectionPayload({
    providerId: args.conversation.providerId,
    text: args.initialPrompt,
  });

  let injected = false;
  let sawAnyOutput = false;
  let sawReadyOutput = false;
  let outputBuffer = '';
  let quietTimer: ReturnType<typeof setTimeout> | null = null;

  const inject = () => {
    if (injected) return;
    injected = true;
    if (quietTimer) clearTimeout(quietTimer);
    try {
      const submitSequence = provider.keystrokeSubmitSequence ?? '\r';
      const submitDelayMs = provider.keystrokeSubmitDelayMs;
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

  args.pty.onData((data) => {
    if (injected) return;
    sawAnyOutput = true;
    outputBuffer = `${outputBuffer}${data}`.slice(-OUTPUT_BUFFER_MAX);
    if (SHELL_FAILURE_OUTPUT.test(outputBuffer)) {
      injected = true;
      if (quietTimer) clearTimeout(quietTimer);
      log.warn('ConversationProvider: shell output detected before initial prompt injection', {
        providerId: args.conversation.providerId,
        conversationId: args.conversation.id,
      });
      return;
    }
    sawReadyOutput = sawReadyOutput || readyOutput.test(outputBuffer);
    if (!sawReadyOutput) return;
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(inject, QUIET_PERIOD_MS);
  });

  args.pty.onExit(() => {
    const promptWasInjected = injected;
    injected = true;
    if (quietTimer) clearTimeout(quietTimer);
    if (!promptWasInjected) {
      log.warn('ConversationProvider: PTY exited before initial prompt could be injected', {
        providerId: args.conversation.providerId,
        conversationId: args.conversation.id,
        sawAnyOutput,
        sawReadyOutput,
      });
      events.emit(conversationInitialPromptInjectionFailedChannel, {
        conversationId: args.conversation.id,
        taskId: args.conversation.taskId,
        projectId: args.conversation.projectId,
        providerId: args.conversation.providerId,
      });
    }
  });
}
