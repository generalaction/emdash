import { createAutohandClassifier } from '@main/core/agent-hooks/classifiers/autohand';
import { createProviderPlugin } from '../types';

export const autohandPlugin = createProviderPlugin(() => ({
  createClassifier: createAutohandClassifier,
}));
