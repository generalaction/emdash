import type { ProviderId } from '@shared/providers/registry';
import { createAmpClassifier } from './amp';
import { createAuggieClassifier } from './auggie';
import { createAutohandClassifier } from './autohand';
import type { ProviderClassifier } from './base';
import { createCharmClassifier } from './charm';
import { createClaudeClassifier } from './claude';
import { createClineClassifier } from './cline';
import { createCodebuffClassifier } from './codebuff';
import { createCodexClassifier } from './codex';
import { createContinueClassifier } from './continue';
import { createCopilotClassifier } from './copilot';
import { createCursorClassifier } from './cursor';
import { createDroidClassifier } from './droid';
import { createGeminiClassifier } from './gemini';
import { createGenericClassifier } from './generic';
import { createGooseClassifier } from './goose';
import { createKilocodeClassifier } from './kilocode';
import { createKimiClassifier } from './kimi';
import { createKiroClassifier } from './kiro';
import { createMistralClassifier } from './mistral';
import { createOpenCodeClassifier } from './opencode';
import { createPiClassifier } from './pi';
import { createQwenClassifier } from './qwen';
import { createRovoClassifier } from './rovo';

export type { ProviderClassifier, ClassificationResult } from './base';

const classifierFactories: Record<ProviderId, () => ProviderClassifier> = {
  amp: createAmpClassifier,
  auggie: createAuggieClassifier,
  autohand: createAutohandClassifier,
  charm: createCharmClassifier,
  claude: createClaudeClassifier,
  cline: createClineClassifier,
  codebuff: createCodebuffClassifier,
  codex: createCodexClassifier,
  continue: createContinueClassifier,
  copilot: createCopilotClassifier,
  cursor: createCursorClassifier,
  droid: createDroidClassifier,
  gemini: createGeminiClassifier,
  goose: createGooseClassifier,
  kilocode: createKilocodeClassifier,
  kimi: createKimiClassifier,
  kiro: createKiroClassifier,
  mistral: createMistralClassifier,
  opencode: createOpenCodeClassifier,
  pi: createPiClassifier,
  qwen: createQwenClassifier,
  rovo: createRovoClassifier,
};

export function createClassifier(providerId: ProviderId): ProviderClassifier {
  const factory = classifierFactories[providerId];
  return factory ? factory() : createGenericClassifier();
}
