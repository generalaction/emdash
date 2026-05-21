import { createJulesClassifier } from '@main/core/agent-hooks/classifiers/jules';
import { createProviderPlugin } from '../types';

export const julesPlugin = createProviderPlugin(() => ({
  createClassifier: createJulesClassifier,
}));
