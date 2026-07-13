import type { Logger } from '@emdash/shared/logger';
import type { ResolvedTuiProvider } from '@services/agent-plugins/api/plugins';
import { buildPromptInjectionPayload } from '@services/agent-plugins/api/plugins/helpers';
import type { PtyProcess } from '@services/pty/api';

const QUIET_PERIOD_MS = 800;
const MAX_WAIT_MS = 15_000;

export function scheduleInitialPromptInjection(args: {
  pty: PtyProcess;
  providerId: string;
  provider: Pick<ResolvedTuiProvider, 'prompt'>;
  conversationId: string;
  initialPrompt: string | undefined;
  isResuming: boolean;
  logger: Logger;
}): void {
  if (args.isResuming) return;
  if (!args.initialPrompt?.trim()) return;
  if (args.provider.prompt.kind !== 'keystroke') return;

  const submitSequence = args.provider.prompt.submitSequence ?? '\r';
  const submitDelayMs = args.provider.prompt.submitDelayMs;
  const payload = buildPromptInjectionPayload({
    providerId: args.providerId,
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
      args.logger.warn('TuiAgentsRuntime: failed to inject initial prompt', {
        providerId: args.providerId,
        conversationId: args.conversationId,
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
      args.logger.warn('TuiAgentsRuntime: PTY exited before initial prompt could be injected', {
        providerId: args.providerId,
        conversationId: args.conversationId,
        sawAnyOutput,
      });
    }
  });
}
