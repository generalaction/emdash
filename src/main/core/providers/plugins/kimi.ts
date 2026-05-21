import { createKimiClassifier } from '@main/core/agent-hooks/classifiers/kimi';
import { createProviderPlugin } from '../types';

export const kimiPlugin = createProviderPlugin(() => ({
  createClassifier: createKimiClassifier,
}));
