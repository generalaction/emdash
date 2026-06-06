import { createProviderClassifier, type ClassificationResult } from './base';

export function createCommandCodeClassifier() {
  return createProviderClassifier((text: string): ClassificationResult => {
    const tail = text.slice(-500);

    if (/approve|reject|permission|allow|confirm|trust.*project|proceed/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'permission_prompt',
      };
    }

    if (/session ended|✓|✔|Task completed|Finished|Done\./i.test(tail)) {
      return {
        type: 'stop',
        message: 'Task completed',
      };
    }

    if (
      /Ready|Awaiting|Press Enter|Next command|Type your message|(?:^|\n)\s*[>❯]\s*$/i.test(tail)
    ) {
      return {
        type: 'notification',
        notificationType: 'idle_prompt',
      };
    }

    if (/Successfully authenticated|Login successful|Signed in|Authenticated/i.test(text)) {
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
