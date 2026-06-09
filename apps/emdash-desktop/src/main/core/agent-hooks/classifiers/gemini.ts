import { createProviderClassifier, type ClassificationResult } from './base';

export function createGeminiClassifier() {
  return createProviderClassifier((text: string): ClassificationResult => {
    const tail = text.slice(-500);

    if (/Action Required/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'permission_prompt',
      };
    }

    if (/\[INSERT\]|\[NORMAL\]/.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'idle_prompt',
      };
    }

    return undefined;
  });
}
