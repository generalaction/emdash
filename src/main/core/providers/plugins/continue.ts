import { createContinueClassifier } from '@main/core/agent-hooks/classifiers/continue';
import { createProviderPlugin } from '../types';

export const continuePlugin = createProviderPlugin(() => ({
  createClassifier: createContinueClassifier,
}));
