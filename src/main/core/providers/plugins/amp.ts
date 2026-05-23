import { createAmpClassifier } from '@main/core/agent-hooks/classifiers/amp';
import { createProviderPlugin } from '../types';

export const ampPlugin = createProviderPlugin(() => ({
  createClassifier: createAmpClassifier,
}));
