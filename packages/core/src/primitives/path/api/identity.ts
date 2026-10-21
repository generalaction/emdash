import { formatAbsolute, parseAbsolute, parseNativeAbsolute } from './absolute';
import { comparisonKeyForAbsolutePath } from './semantics';
import type { PathProfile } from './types';

/**
 * Produces the canonical identity key for an absolute native path while leaving its
 * display spelling untouched. Supplying a profile is required when the string's
 * dialect is not self-describing at this owning-host boundary.
 */
export function nativePathIdentityKey(input: string, profile?: Partial<PathProfile>): string {
  const parsed = parseNativePath(input, profile);
  if (!parsed.success) throw new Error(parsed.error.message);
  return comparisonKeyForAbsolutePath(parsed.data, profile);
}

/**
 * Keeps the first canonical display spelling for an unchanged identity. A legacy
 * non-canonical spelling (for example `/repo/../repo`) is replaced by the incoming
 * canonical spelling instead of being frozen forever.
 */
export function stableNativePathDisplay(
  current: string,
  incoming: string,
  profile?: Partial<PathProfile>
): string {
  if (nativePathIdentityKey(current, profile) !== nativePathIdentityKey(incoming, profile)) {
    return incoming;
  }
  const parsed = parseNativePath(current, profile);
  if (!parsed.success) return incoming;
  const separatorNormalized =
    parsed.data.root.kind === 'posix' ? current : current.replaceAll('\\', '/');
  return separatorNormalized === formatAbsolute(parsed.data) ? current : incoming;
}

function parseNativePath(input: string, profile?: Partial<PathProfile>) {
  return profile ? parseAbsolute(input, { profile }) : parseNativeAbsolute(input);
}
