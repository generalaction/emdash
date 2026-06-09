import { createProviderClassifier, type ClassificationResult } from './base';

export function createContinueClassifier() {
  return createProviderClassifier((text: string): ClassificationResult => {
    const tail = text.slice(-500);

    // Permission/approval prompts
    if (/approve|reject|permission|allow|confirm/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'permission_prompt',
      };
    }

    // Idle/ready prompts
    if (/Ready|Awaiting|Press Enter/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'idle_prompt',
      };
    }

    if (/cn\s*>|continue\s*>/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'idle_prompt',
      };
    }

    // Auth success
    if (/Successfully authenticated|Login successful/i.test(text)) {
      return {
        type: 'notification',
        notificationType: 'auth_success',
      };
    }

    // Questions/elicitation
    if (/What.*\?|How can I|Next step/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'elicitation_dialog',
      };
    }

    // Error detection
    if (/error:|fatal:|exception|failed/i.test(text)) {
      return {
        type: 'error',
      };
    }

    return undefined;
  });
}
