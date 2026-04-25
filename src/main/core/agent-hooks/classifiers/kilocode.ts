import { createProviderClassifier, type ClassificationResult } from './base';

export function createKilocodeClassifier() {
  return createProviderClassifier((text: string): ClassificationResult => {
    const tail = text.slice(-500);

    // Permission/approval prompts
    if (/approve|reject|permission|allow|confirm/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'permission_prompt',
      };
    }

    // Task completion (potential stop signal)
    if (/✓\s*Task Completed|Checkpoint Saved/i.test(tail)) {
      return {
        type: 'stop',
        message: 'Task completed',
      };
    }

    // Idle/ready prompts
    if (/Type a message or \/command/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'idle_prompt',
      };
    }

    if (/What would you like to work on/i.test(tail)) {
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

    if (/\/help for commands|\/mode to switch mode|! for shell mode/i.test(tail)) {
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
