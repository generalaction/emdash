import {
  createCodebuffClassifier,
  createFreebuffClassifier,
} from '@main/core/agent-hooks/classifiers/codebuff';
import { createProviderPlugin } from '../types';

export const codebuffPlugin = createProviderPlugin(() => ({
  createClassifier: createCodebuffClassifier,
}));

export const freebuffPlugin = createProviderPlugin(() => ({
  createClassifier: createFreebuffClassifier,
}));
