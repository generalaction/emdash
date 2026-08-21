import type { Commit } from '@emdash/core/runtimes/git/api';
import { toast } from '@emdash/ui/react/primitives';

/** Subject plus body, in the shape `git log` prints the message. */
export function commitFullMessage(commit: Commit): string {
  return commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject;
}

/** Shared by the commit context menu and the details modal so both report copies identically. */
export async function copyCommitValue(value: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast(`${label} copied`);
  } catch {
    toast.error('Copy failed', {
      description: `The ${label.toLowerCase()} could not be copied to the clipboard.`,
    });
  }
}
