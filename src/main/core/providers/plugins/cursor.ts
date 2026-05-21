import { createCursorClassifier } from '@main/core/agent-hooks/classifiers/cursor';
import { createProviderPlugin } from '../types';

export const cursorPlugin = createProviderPlugin(() => ({
  createClassifier: createCursorClassifier,
}));
