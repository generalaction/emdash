import { createKiroClassifier } from '@main/core/agent-hooks/classifiers/kiro';
import { createProviderPlugin } from '../types';

export const kiroPlugin = createProviderPlugin(() => ({
  createClassifier: createKiroClassifier,
}));
