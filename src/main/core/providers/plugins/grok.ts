import { createGrokClassifier } from '@main/core/agent-hooks/classifiers/grok';
import { createProviderPlugin } from '../types';

export const grokPlugin = createProviderPlugin(() => ({
  createClassifier: createGrokClassifier,
}));
