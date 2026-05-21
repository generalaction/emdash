import { createCharmClassifier } from '@main/core/agent-hooks/classifiers/charm';
import { createProviderPlugin } from '../types';

export const charmPlugin = createProviderPlugin(() => ({
  createClassifier: createCharmClassifier,
}));
