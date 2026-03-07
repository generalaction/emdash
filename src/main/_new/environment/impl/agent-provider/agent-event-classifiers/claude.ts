import { createProviderClassifier, type ClassificationResult } from './base';

export function createClaudeClassifier() {
  return createProviderClassifier((text: string): ClassificationResult => {
    // Check last ~500 chars for prompt patterns
    const tail = text.slice(-500);

    // Permission/approval prompts
    if (/approve|reject|permission|allow/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'permission_prompt',
      };
    }

    // Idle/ready prompts
    if (/Ready|Awaiting|Next command|Use \/login/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'idle_prompt',
      };
    }

    // Auth success
    if (/Successfully authenticated|Login successful|logged in/i.test(text)) {
      return {
        type: 'notification',
        notificationType: 'auth_success',
      };
    }

    // Questions/elicitation
    if (/What.*\?|How.*\?|Which.*\?|Please (provide|specify|clarify)/i.test(tail)) {
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
