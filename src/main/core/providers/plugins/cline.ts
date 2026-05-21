import { createClineClassifier } from '@main/core/agent-hooks/classifiers/cline';
import { createProviderPlugin } from '../types';

export const clinePlugin = createProviderPlugin(() => ({
  createClassifier: createClineClassifier,
}));
