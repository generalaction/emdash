import { createAntigravityClassifier } from '@main/core/agent-hooks/classifiers/antigravity';
import { createProviderPlugin } from '../types';

export const antigravityPlugin = createProviderPlugin(() => ({
  createClassifier: createAntigravityClassifier,
}));
