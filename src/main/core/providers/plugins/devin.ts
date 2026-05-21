import { createDevinClassifier } from '@main/core/agent-hooks/classifiers/devin';
import { createProviderPlugin } from '../types';

export const devinPlugin = createProviderPlugin(() => ({
  createClassifier: createDevinClassifier,
}));
