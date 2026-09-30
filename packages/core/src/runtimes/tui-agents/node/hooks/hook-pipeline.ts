import type { Logger } from '@emdash/shared/logger';
import type { CanonicalHookEvent, ResolvedTuiProvider } from '#services/agent-plugins/api/plugins';
import { defaultHookEventParser } from '#services/agent-plugins/api/plugins/helpers';
import type { RawHookRequest } from './types';

export type HookConversationConfig = {
  conversationId: string;
  providerId: string;
};

export type TuiHookPipelineOptions = {
  getConversationConfig(conversationId: string): HookConversationConfig | null;
  getProvider(providerId: string): ResolvedTuiProvider | null;
  applyCanonicalEvent(conversationId: string, providerId: string, event: CanonicalHookEvent): void;
  logger: Logger;
};

export class TuiHookPipeline {
  constructor(private readonly options: TuiHookPipelineOptions) {}

  async handle(raw: RawHookRequest): Promise<void> {
    const config = this.options.getConversationConfig(raw.ptyId);
    if (!config) {
      this.options.logger.warn('TuiHookPipeline: unrecognized hook conversation id', {
        ptyId: raw.ptyId,
        type: raw.type,
      });
      return;
    }

    const provider = this.options.getProvider(config.providerId);
    if (!provider) {
      this.options.logger.warn('TuiHookPipeline: hook provider is unavailable', {
        conversationId: config.conversationId,
        providerId: config.providerId,
        type: raw.type,
      });
      return;
    }

    const body = parseHookBody(raw.body);
    let event = provider.parseHookEvent?.(raw.type, body) ?? defaultHookEventParser(raw.type, body);
    const validateSessionId = provider.validateSessionId;
    if (event.kind === 'session') {
      if (validateSessionId && !validateSessionId(event.providerSessionId)) return;
    } else if (
      event.kind === 'status' &&
      event.providerSessionId !== undefined &&
      validateSessionId &&
      !validateSessionId(event.providerSessionId)
    ) {
      const { providerSessionId: _invalid, ...rest } = event;
      event = rest;
    }

    this.options.applyCanonicalEvent(config.conversationId, config.providerId, event);
  }
}

function parseHookBody(body: string): Record<string, unknown> {
  if (!body) return {};
  try {
    const value: unknown = JSON.parse(body);
    if (typeof value === 'object' && value !== null) return value as Record<string, unknown>;
  } catch {}
  return {};
}
