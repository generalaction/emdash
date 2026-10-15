import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { desktopHostContract, desktopHostDomain, type ClipboardSource } from '../api/host-contract';

export type HostClient = ContractClient<typeof desktopHostContract>;

/** Typed client for the desktop host wire domain (shell, clipboard, dialogs, window). */
export function getHostClient(): Promise<HostClient> {
  return domainClient<HostClient>(desktopHostDomain, desktopHostContract);
}

export async function openExternal(url: string) {
  return (await getHostClient()).openExternal({ url });
}

let clipboardTail: Promise<unknown> = Promise.resolve();

// App-owned clipboard access runs in invocation order: a read issued after a copy observes
// that copy, and an earlier automatic copy cannot land after a later explicit one.
function sequenceClipboard<T>(operation: () => Promise<T>): Promise<T> {
  const result = clipboardTail.then(operation, operation);
  clipboardTail = result.catch(() => {});
  return result;
}

// Receipts of app copies that have not settled yet: true once the copy reached the clipboard.
const pendingCopies = new Set<Promise<boolean>>();

export function copyTextToClipboard(text: string) {
  const result = sequenceClipboard(async () =>
    (await getHostClient()).clipboardWriteText({ text })
  );
  const receipt = result.then(
    (outcome) => outcome.success,
    () => false
  );
  pendingCopies.add(receipt);
  void receipt.then(() => pendingCopies.delete(receipt));
  return result;
}

/**
 * True while an app copy has not reached the system clipboard yet, so a browser paste
 * event's clipboard payload may predate it.
 */
export function hasPendingClipboardWrite(): boolean {
  return pendingCopies.size > 0;
}

export class ClipboardCopyFailedError extends Error {
  constructor() {
    super('The copy before this paste did not reach the clipboard, so nothing was pasted.');
    this.name = 'ClipboardCopyFailedError';
  }
}

// A clipboard read issued while copies are pending is meant to see them: if one fails, the
// clipboard still holds what the user replaced, so the read fails instead of returning it.
// Copies issued after the read do not affect it, and the primary selection never depends on
// clipboard copies.
function readAfterPendingCopies<T>(source: ClipboardSource, read: () => Promise<T>): Promise<T> {
  const copies = source === 'clipboard' ? [...pendingCopies] : [];
  return sequenceClipboard(async () => {
    if (!(await Promise.all(copies)).every(Boolean)) throw new ClipboardCopyFailedError();
    return read();
  });
}

export function readClipboardForPaste(source: ClipboardSource = 'clipboard') {
  return readAfterPendingCopies(source, async () =>
    (await getHostClient()).clipboardReadPaste({ source })
  );
}

/** Persists the system clipboard's image, if any, for a paste to attach later. */
export function snapshotClipboardImage() {
  return readAfterPendingCopies('clipboard', async () =>
    (await getHostClient()).persistClipboardImage()
  );
}
