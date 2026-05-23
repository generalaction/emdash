import { createQwenClassifier } from '@main/core/agent-hooks/classifiers/qwen';
import { createProviderPlugin } from '../types';

export const qwenPlugin = createProviderPlugin(() => ({
  createClassifier: createQwenClassifier,
}));
