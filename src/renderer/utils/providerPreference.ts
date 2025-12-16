import { isValidProviderId } from '../../shared/providers/registry';

/**
 * Get the preferred provider for a workspace from localStorage
 * @param workspaceId - The workspace ID to look up
 * @returns The preferred provider ID as string, or undefined if not set/invalid
 */
export function getWorkspaceProviderPreference(workspaceId: string | null | undefined): string | undefined {
  if (!workspaceId) return undefined;

  try {
    const wkProvider = localStorage.getItem(`workspaceProvider:${workspaceId}`);
    if (wkProvider && isValidProviderId(wkProvider)) {
      return wkProvider;
    }
  } catch (err) {
    // Fail silently if localStorage access fails
  }

  return undefined;
}
