import { createKilocodeClassifier } from '@main/core/agent-hooks/classifiers/kilocode';
import { createProviderPlugin } from '../types';

export const kilocodePlugin = createProviderPlugin(() => ({
  createClassifier: createKilocodeClassifier,
}));
