import { createLettaClassifier } from '@main/core/agent-hooks/classifiers/letta';
import { createProviderPlugin } from '../types';

export const lettaPlugin = createProviderPlugin(() => ({
  createClassifier: createLettaClassifier,
}));
