import { createProviderClassifier, type ClassificationResult } from './base';

export function createDevinClassifier() {
  return createProviderClassifier((text: string): ClassificationResult => {
    const tail = text.slice(-500);

    if (/approve|reject|permission|allow|confirm|accept edits|bypass/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'permission_prompt',
      };
    }

    if (/Type @|\/help|\/mode|\/plan|\/ask|What would you like|Start coding/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'idle_prompt',
      };
    }

    if (/Ready|Awaiting|Press Enter|Next command/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'idle_prompt',
      };
    }

    if (/Successfully authenticated|Login successful|Authenticated as/i.test(text)) {
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
