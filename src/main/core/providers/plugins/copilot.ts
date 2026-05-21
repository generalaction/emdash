import { createCopilotClassifier } from '@main/core/agent-hooks/classifiers/copilot';
import { createProviderPlugin } from '../types';

export const copilotPlugin = createProviderPlugin(() => ({
  createClassifier: createCopilotClassifier,
}));
