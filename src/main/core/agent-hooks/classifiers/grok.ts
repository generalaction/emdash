import { createProviderClassifier, type ClassificationResult } from './base';

export function createGrokClassifier() {
  return createProviderClassifier((text: string): ClassificationResult => {
    const tail = text.slice(-500);

    if (/(^|[^-])approve|reject|permission|allow|confirm/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'permission_prompt',
      };
    }

    if (/Enter send|Shift-Tab normal|Ask a side question|Type your message/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'idle_prompt',
      };
    }

    if (/Successfully authenticated|Login successful|Signed in to Grok/i.test(text)) {
      return {
        type: 'notification',
        notificationType: 'auth_success',
      };
    }

    if (/What.*\?|How.*\?|Which.*\?|Please (provide|specify|clarify)/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'elicitation_dialog',
      };
    }

    if (/error:|fatal:|exception|failed/i.test(text)) {
      return {
        type: 'error',
      };
    }

    return undefined;
  });
}
