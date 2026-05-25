import { createProviderClassifier, type ClassificationResult } from './base';

export function createCursorClassifier(options?: { hooksHandleStop?: boolean }) {
  const hooksHandleStop = options?.hooksHandleStop ?? false;

  return createProviderClassifier((text: string, chunk: string): ClassificationResult => {
    const tail = text.slice(-500);
    const chunkTail = chunk.slice(-200);

    // Agent is actively thinking or executing (PTY may not see Enter)
    if (
      /Thought for \d+ms|Planning|Searching|Generating|Running command|Executing/i.test(chunkTail)
    ) {
      return { type: 'start' };
    }

    // Permission/approval prompts
    if (/Allow once|Allow always|Needs approval|Run this command\?/i.test(tail)) {
      return {
        type: 'notification',
        notificationType: 'permission_prompt',
      };
    }

    // Idle is owned by the Cursor `stop` hook — PTY scrollback still shows "Add a follow-up"
    // while the agent runs, which would immediately clear the working state.
    if (!hooksHandleStop) {
      if (
        /(?:→\s*)?Add a follow-up|Write your follow-up|follow-up to continue|Plan, search, build anything|Plan, @ for context|Run a command — \/plan/i.test(
          tail
        ) ||
        /ctrl\+c to stop|Esc to cancel|\/ for commands/i.test(tail)
      ) {
        return {
          type: 'notification',
          notificationType: 'idle_prompt',
        };
      }

      if (/Auto\s*[\r\n]+\s*\/\s*commands/i.test(tail)) {
        return {
          type: 'notification',
          notificationType: 'idle_prompt',
        };
      }
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
