const eligibilityKey = (projectId: string) => `emdash:setup-suggestion-eligible:${projectId}`;
const dismissKey = (projectId: string) => `emdash:setup-suggestion-dismissed:${projectId}`;

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, 'true');
  } catch {
    // ignore — localStorage is best-effort UI state
  }
}

function removeFlag(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore — localStorage is best-effort UI state
  }
}

export function markSetupSuggestionEligible(projectId: string): void {
  writeFlag(eligibilityKey(projectId));
}

export function shouldShowSetupSuggestion(projectId: string): boolean {
  return readFlag(eligibilityKey(projectId)) && !readFlag(dismissKey(projectId));
}

export function dismissSetupSuggestion(projectId: string): void {
  writeFlag(dismissKey(projectId));
  removeFlag(eligibilityKey(projectId));
}

export function clearSetupSuggestionEligibility(projectId: string): void {
  removeFlag(eligibilityKey(projectId));
}
