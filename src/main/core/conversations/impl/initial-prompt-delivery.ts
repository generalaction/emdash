import type { Pty } from '@main/core/pty/pty';
import { log } from '@main/lib/logger';
import { getProvider, type AgentProviderId } from '@shared/agent-provider-registry';
import type { ProviderCustomConfig } from '@shared/app-settings';
import { buildPromptInjectionPayload } from '@shared/prompt-injection';
import { parseArgField } from './agent-command';

const KEYSTROKE_INJECTION_DELAY_MS = 1000;
const DEFAULT_KEYSTROKE_SUBMIT_SEQUENCE = '\r';

export interface InitialPromptDelivery {
  argvAddition(): readonly string[];
  afterSpawn(pty: Pty): void;
}

const NO_OP_DELIVERY: InitialPromptDelivery = {
  argvAddition: () => [],
  afterSpawn: () => {},
};

export function createInitialPromptDelivery(args: {
  providerId: AgentProviderId;
  conversationId: string;
  providerConfig: ProviderCustomConfig | undefined;
  initialPrompt: string | undefined;
  isResuming: boolean;
}): InitialPromptDelivery {
  if (args.isResuming) return NO_OP_DELIVERY;
  if (!args.initialPrompt?.trim()) return NO_OP_DELIVERY;

  const provider = getProvider(args.providerId);
  if (provider?.useKeystrokeInjection) {
    return new KeystrokeDelivery(args.providerId, args.conversationId, args.initialPrompt);
  }
  if (provider?.initialPromptViaStdinPipe) return NO_OP_DELIVERY;

  return new ArgvDelivery(args.providerConfig?.initialPromptFlag, args.initialPrompt);
}

class ArgvDelivery implements InitialPromptDelivery {
  private readonly tokens: readonly string[];

  constructor(initialPromptFlag: string | undefined, initialPrompt: string) {
    this.tokens = [...parseArgField(initialPromptFlag), initialPrompt];
  }

  argvAddition(): readonly string[] {
    return this.tokens;
  }

  afterSpawn(): void {}
}

class KeystrokeDelivery implements InitialPromptDelivery {
  constructor(
    private readonly providerId: AgentProviderId,
    private readonly conversationId: string,
    private readonly initialPrompt: string
  ) {}

  argvAddition(): readonly string[] {
    return [];
  }

  afterSpawn(pty: Pty): void {
    const provider = getProvider(this.providerId);
    if (!provider?.useKeystrokeInjection) return;

    const payload = buildPromptInjectionPayload({
      providerId: this.providerId,
      text: this.initialPrompt,
    });
    if (!payload) return;

    const submitSequence = provider.keystrokeSubmitSequence ?? DEFAULT_KEYSTROKE_SUBMIT_SEQUENCE;
    const submitDelayMs = provider.keystrokeSubmitDelayMs;

    setTimeout(() => {
      try {
        if (submitDelayMs) {
          pty.write(payload);
          setTimeout(() => {
            try {
              pty.write(submitSequence);
            } catch (error) {
              log.warn('ConversationProvider: failed to submit initial prompt', {
                providerId: this.providerId,
                conversationId: this.conversationId,
                error: String(error),
              });
            }
          }, submitDelayMs);
          return;
        }

        pty.write(`${payload}${submitSequence}`);
      } catch (error) {
        log.warn('ConversationProvider: failed to inject initial prompt', {
          providerId: this.providerId,
          conversationId: this.conversationId,
          error: String(error),
        });
      }
    }, KEYSTROKE_INJECTION_DELAY_MS);
  }
}
