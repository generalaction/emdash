/**
 * Reduce a (potentially long, multi-line) raw git/hook error string to a single
 * concise sentence suitable for a toast description.
 *
 * The full text should still be preserved separately so users can view it in a
 * details dialog — see `useErrorDetails`.
 */
export function friendlyGitError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('non-fast-forward') || s.includes('tip of your current branch is behind'))
    return 'Remote has new commits. Pull before pushing.';
  if (s.includes('merge conflict') || s.includes('fix conflicts'))
    return 'Merge conflicts detected. Resolve them in your editor.';
  if (s.includes('permission denied') || s.includes('authentication'))
    return 'Authentication failed. Check your credentials.';
  if (s.includes('could not resolve host') || s.includes('unable to access'))
    return 'Cannot reach remote. Check your network connection.';
  if (s.includes('no such remote')) return 'No remote configured for this repository.';
  if (s.includes('cannot undo the initial commit')) return 'Cannot undo the initial commit.';
  if (s.includes('nothing to commit')) return 'Nothing to commit.';
  if (s.includes('pre-commit') || s.includes('commit-msg') || s.includes('husky'))
    return 'A git hook rejected the commit. View details for the full output.';
  // Return first meaningful line, capped
  const firstLine = raw.split('\n').find((l) => l.trim().length > 0) || raw;
  return firstLine.length > 120 ? firstLine.slice(0, 120) + '...' : firstLine;
}
