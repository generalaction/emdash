import type { AgentProviderId } from '@shared/agent-provider-registry';
import { createAmpClassifier } from './amp';
import { createAntigravityClassifier } from './antigravity';
import { createAuggieClassifier } from './auggie';
import { createAutohandClassifier } from './autohand';
import type { ProviderClassifier } from './base';
import { createCharmClassifier } from './charm';
import { createClineClassifier } from './cline';
import { createCodebuffClassifier, createFreebuffClassifier } from './codebuff';
import { createContinueClassifier } from './continue';
import { createCopilotClassifier } from './copilot';
import { createCursorClassifier } from './cursor';
import { createDevinClassifier } from './devin';
import { createDroidClassifier } from './droid';
import { createGeminiClassifier } from './gemini';
import { createGenericClassifier } from './generic';
import { createGooseClassifier } from './goose';
import { createGrokClassifier } from './grok';
import { createJulesClassifier } from './jules';
import { createJunieClassifier } from './junie';
import { createKilocodeClassifier } from './kilocode';
import { createKimiClassifier } from './kimi';
import { createKiroClassifier } from './kiro';
import { createLettaClassifier } from './letta';
import { createMistralClassifier } from './mistral';
import { createOpenCodeClassifier } from './opencode';
import { createPiClassifier } from './pi';
import { createQwenClassifier } from './qwen';
import { createRovoClassifier } from './rovo';

export type { ProviderClassifier, ClassificationResult } from './base';

const classifierFactories: Partial<Record<AgentProviderId, () => ProviderClassifier>> = {
  antigravity: createAntigravityClassifier,
  amp: createAmpClassifier,
  auggie: createAuggieClassifier,
  autohand: createAutohandClassifier,
  charm: createCharmClassifier,
  cline: createClineClassifier,
  codebuff: createCodebuffClassifier,
  continue: createContinueClassifier,
  copilot: createCopilotClassifier,
  cursor: createCursorClassifier,
  devin: createDevinClassifier,
  droid: createDroidClassifier,
  freebuff: createFreebuffClassifier,
  gemini: createGeminiClassifier,
  goose: createGooseClassifier,
  grok: createGrokClassifier,
  jules: createJulesClassifier,
  junie: createJunieClassifier,
  kilocode: createKilocodeClassifier,
  kimi: createKimiClassifier,
  kiro: createKiroClassifier,
  letta: createLettaClassifier,
  mistral: createMistralClassifier,
  opencode: createOpenCodeClassifier,
  pi: createPiClassifier,
  qwen: createQwenClassifier,
  rovo: createRovoClassifier,
};

export type CreateClassifierOptions = {
  /** Cursor `stop` hook owns idle; avoid PTY false-positives from stale follow-up text. */
  cursorHooksHandleStop?: boolean;
};

export function createClassifier(
  providerId: AgentProviderId,
  options: CreateClassifierOptions = {}
): ProviderClassifier {
  if (providerId === 'cursor') {
    return createCursorClassifier({ hooksHandleStop: options.cursorHooksHandleStop });
  }
  const factory = classifierFactories[providerId];
  return factory ? factory() : createGenericClassifier();
}
