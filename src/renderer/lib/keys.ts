// If providerId is supplied, scope the flag per provider; otherwise fall back to legacy key.
export const initialPromptSentKey = (scopeId: string, providerId?: string) =>
  providerId && providerId.trim()
    ? `initialPromptSent:${scopeId}:${providerId.trim()}`
    : `initialPromptSent:${scopeId}`;
