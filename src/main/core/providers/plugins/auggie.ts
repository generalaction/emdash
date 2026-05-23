import { createAuggieClassifier } from '@main/core/agent-hooks/classifiers/auggie';
import { createProviderPlugin } from '../types';

export const auggiePlugin = createProviderPlugin(() => ({
  createClassifier: createAuggieClassifier,
}));
