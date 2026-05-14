import { createProviderClassifier, type ClassificationResult } from './base';

/**
 * Codex-specific terminal classifier.
 *
 * Codex hooks are the preferred signal, but project-local hooks can be held for
 * review (`/hooks`) and therefore not execute. This classifier keeps Emdash's
 * status usable while hooks are pending or disabled.
 */
export function createCodexClassifier() {
  return createProviderClassifier((text: string): ClassificationResult => {
    const tail = text.slice(-1000);

    if (/hooks? need review|Open \/hooks to review/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'elicitation_dialog',
        message: 'Codex hooks need review',
      };
    }

    if (
      /PermissionRequest|permission request|requires approval|needs approval|approve|allow command|allow this command|\bAllow\?/i.test(
        tail
      )
    ) {
      return {
        type: 'notification',
        notificationType: 'permission_prompt',
      };
    }

    if (/\b(continue|proceed)\?\s*(\[[yn]\/[yn]\])?/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'permission_prompt',
      };
    }

    if (/›\s*$|Type a message|Ask Codex|Press Enter|Waiting for input/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'idle_prompt',
      };
    }

    if (
      /Task complete|Finished|Done\.?|All set|Goal achieved|Goal unmet|Goal abandoned/i.test(tail)
    ) {
      return {
        type: 'stop',
        message: 'Task completed',
      };
    }

    if (/error:|fatal:|exception|failed/i.test(tail)) {
      return { type: 'error' };
    }

    return undefined;
  });
}
