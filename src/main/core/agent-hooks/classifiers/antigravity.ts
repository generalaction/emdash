import { createProviderClassifier, type ClassificationResult } from './base';

export function createAntigravityClassifier() {
  return createProviderClassifier((text: string, chunk: string): ClassificationResult => {
    const tail = text.slice(-700);
    const permissionPromptIndex = tail.search(
      /approve|reject|permission|allow|confirm|run command/i
    );
    const authSuccessIndex = chunk.search(/Successfully authenticated|Login successful|Signed in/i);
    const errorIndex = chunk.search(/^\s*(?:error|fatal|exception|failed):/im);
    const readyPromptIndex = Math.max(
      tail.search(/^\s*>\s*$/m),
      tail.search(/\? for shortcuts/i),
      tail.search(/How can I help|let me know|Anything else|What would you like/i)
    );
    const generatingIndex = tail.lastIndexOf('Generating...');
    const lastActionableIndex = Math.max(
      permissionPromptIndex,
      authSuccessIndex,
      errorIndex,
      readyPromptIndex
    );

    if (generatingIndex > lastActionableIndex) {
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
