import { createMistralClassifier } from '@main/core/agent-hooks/classifiers/mistral';
import { createProviderPlugin } from '../types';

export const mistralPlugin = createProviderPlugin(() => ({
  createClassifier: createMistralClassifier,
}));
