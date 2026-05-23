import { createGooseClassifier } from '@main/core/agent-hooks/classifiers/goose';
import { createProviderPlugin } from '../types';

export const goosePlugin = createProviderPlugin(() => ({
  createClassifier: createGooseClassifier,
}));
