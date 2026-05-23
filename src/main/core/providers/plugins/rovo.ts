import { createRovoClassifier } from '@main/core/agent-hooks/classifiers/rovo';
import { createProviderPlugin } from '../types';

export const rovoPlugin = createProviderPlugin(() => ({
  createClassifier: createRovoClassifier,
}));
