import { createProviderClassifier, type ClassificationResult } from './base';

export function createMistralClassifier() {
  return createProviderClassifier((text: string): ClassificationResult => {
    const tail = text.slice(-500);

    // Permission/approval prompts (y/n confirmations)
    if (/\[y\/n\]|\[Y\/N\]|Continue\?|Approve|Reject|Cancel/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'permission_prompt',
      };
    }

    // Task completion
    if (/✓|✔|Completed|Finished|Done\.|Task completed/i.test(tail)) {
      return {
        type: 'stop',
        message: 'Task completed',
      };
    }

    // Idle/ready prompts
    if (/Type.*message|Enter.*prompt/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'idle_prompt',
      };
    }

    if (/What would you like|How can I help/i.test(tail)) {
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

    if (/\bvibe\s*>|›|»|>/i.test(tail) && tail.length < 100) {
      return {
        type: 'notification',
        notificationType: 'idle_prompt',
      };
    }

    // Auth success
    if (/Successfully authenticated|Login successful|API key accepted/i.test(text)) {
      return {
        type: 'notification',
        notificationType: 'auth_success',
      };
    }

    // Questions/elicitation
    if (/What.*\?|Please.*:/i.test(tail)) {
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
