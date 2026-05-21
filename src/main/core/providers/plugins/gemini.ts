import { createGeminiClassifier } from '@main/core/agent-hooks/classifiers/gemini';
import { createProviderPlugin } from '../types';

export const geminiPlugin = createProviderPlugin(() => ({
  createClassifier: createGeminiClassifier,
}));
