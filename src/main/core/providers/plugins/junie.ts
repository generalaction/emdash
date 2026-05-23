import { createJunieClassifier } from '@main/core/agent-hooks/classifiers/junie';
import { createProviderPlugin } from '../types';

export const juniePlugin = createProviderPlugin(() => ({
  createClassifier: createJunieClassifier,
}));
