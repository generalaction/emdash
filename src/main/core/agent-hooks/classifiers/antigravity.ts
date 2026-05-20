import { createProviderClassifier, type ClassificationResult } from './base';

export function createAntigravityClassifier() {
  return createProviderClassifier((text: string, chunk: string): ClassificationResult => {
    const tailStart = Math.max(0, text.length - 700);
    const tail = text.slice(tailStart);
    const permissionPromptIndex = tail.search(
      /\b(?:approve|reject)\b.*\?|permission\s+(?:required|denied|requested)|run command\?/i
    );
    const authSuccessIndex = chunk.search(/Successfully authenticated|Login successful|Signed in/i);
    const errorIndex = chunk.search(/^\s*(?:error|fatal|exception|failed):/im);
    const readyPromptIndex = Math.max(
      tail.search(/^\s*>\s*$/m),
      tail.search(/\? for shortcuts/i),
      tail.search(/How can I help|let me know|Anything else|What would you like/i)
    );
    const chunkStart = text.length - chunk.length;
    const generatingIndex = tail.lastIndexOf('Generating...');
    const lastActionableIndex = Math.max(
      permissionPromptIndex >= 0 ? tailStart + permissionPromptIndex : -1,
      authSuccessIndex >= 0 ? chunkStart + authSuccessIndex : -1,
      errorIndex >= 0 ? chunkStart + errorIndex : -1,
      readyPromptIndex >= 0 ? tailStart + readyPromptIndex : -1
    );

    if (generatingIndex >= 0 && tailStart + generatingIndex > lastActionableIndex) {
      return undefined;
    }

    if (permissionPromptIndex >= 0) {
      return {
        type: 'notification',
        notificationType: 'permission_prompt',
      };
    }

    if (authSuccessIndex >= 0) {
      return {
        type: 'notification',
        notificationType: 'auth_success',
      };
    }

    if (errorIndex >= 0) {
      return {
        type: 'error',
      };
    }

    if (readyPromptIndex >= 0) {
      return {
        type: 'stop',
        message: 'Antigravity is ready for input',
      };
    }

    return undefined;
  });
}
