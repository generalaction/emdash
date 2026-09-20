# Terminal clipboard images and external file drops

## Problem and invariants

A filesystem path is an address on a particular Host. Sending a desktop path through a remote
PTY transfers text, not the file. Clipboard image paste and operating-system file drops must
therefore complete a byte transfer before the remote terminal receives a path.

The old terminal implementation performed this transfer, but commit `f7366e3589` removed it
during the legacy PTY migration. The renderer's path-formatting tests continued to pass because
they never exercised transfer and input together. Separate ACP chat attachment support does not
cover terminal conversations or ordinary shell terminals.

The replacement maintains these invariants:

- Source bytes belong to the desktop; the destination belongs to the captured workspace Host.
- A remote failure never falls back to inserting a desktop path.
- The target publishes only complete files, and terminal insertion happens after publication.
- An operation cannot insert into an unmounted, read-only, or replacement terminal.
- Multiple files retain their input order. Failure rolls back the completed files in that batch.
- File allocation, path interpretation, and expiry belong to the execution Host.

## Research

[Orca's pinned native drop implementation](https://github.com/stablyai/orca/blob/a98314e8bb8e33d1129d8091d6bc831b763380a7/src/renderer/src/components/terminal-pane/terminal-native-file-drop.ts)
captures the terminal owner before uploading and inserts imported destination paths only after
success. Its [target snapshot](https://github.com/stablyai/orca/blob/a98314e8bb8e33d1129d8091d6bc831b763380a7/src/renderer/src/components/terminal-pane/terminal-drop-target.ts)
and [path writer](https://github.com/stablyai/orca/blob/a98314e8bb8e33d1129d8091d6bc831b763380a7/src/renderer/src/components/terminal-pane/terminal-drop-path-writer.ts)
recheck the pane, transport, and PTY before writing. Its
[runtime upload](https://github.com/stablyai/orca/blob/a98314e8bb8e33d1129d8091d6bc831b763380a7/src/renderer/src/runtime/runtime-file-upload-client.ts)
stages bytes and commits only after the stream completes.

[VS Code's terminal path preparation](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/terminalEnvironment.ts)
likewise treats the target environment and shell as necessary context for escaping. A Windows
desktop's path rules cannot determine how a Linux remote terminal receives a path.

Emdash already has typed Host identities, a runtime broker, bounded Wire file channels, and
host-local filesystem operations. These supply the transport and ownership mechanisms needed
here. A second SCP implementation would duplicate connection, cancellation, and identity logic.
The existing ACP attachment store is conversation-scoped and is unsuitable for ordinary shell
terminals. The existing generic `fs.upload` requires a caller-selected destination and has a
different size limit; it does not own temporary attachment allocation or expiry.

## Implementation

`PtyPane` captures the workspace, expected remote Host, actual `FrontendPty` instance, and an
abort signal before asynchronous clipboard persistence or file resolution. DOM image paste,
native clipboard paste, and external drops share the same transfer and insertion helper.
Changing the target or making it read-only aborts pending work. The helper checks liveness again
immediately before insertion. Pending image-paste tracking prevents DOM and native paste paths
from duplicating one image while a network transfer is still running. A native clipboard read
also captures the DOM paste revision: an intervening DOM paste supersedes that native result,
even if it arrives long after the upload completes.

`terminals.prepareAttachments` resolves authoritative workspace identity, checks the expected
Host, and captures both desktop and target runtime clients. It reads a bounded, consistent
desktop file snapshot and streams it to the target in input order. It rejects directories,
oversized or truncated sources, transfer errors, and changed workspace identity. Completed
uploads are deleted on batch failure where the target remains reachable.

`files.fs.uploadTemporary` owns destination allocation. It accepts bounded Wire file data with
no caller-selected destination. The target creates a private namespace outside the repository,
writes an exclusive partial file, enforces the actual byte count, and publishes the final name
after a successful close. It returns a structured host-absolute path. The desktop derives path
style from that returned address and uses the existing terminal escaping and paste framing.

The limits are 20 files per batch and 50 MiB per file. Local file handling retains its existing
behavior. A file dragged from the same workspace's editor tree already has a target-host path
and bypasses upload.

Completed temporary files survive pane and runtime disposal: an agent can still need them after
the upload call returns. A later upload removes recognized, owned files older than 24 hours;
symlinks and unrelated files are excluded. Lost responses or unreachable rollback targets can
leave temporary files until that sweep. PTY insertion and file publication cannot form one
atomic transaction, so the implementation does not automatically retry terminal insertion.

The additive runtime procedure raises the workspace-server protocol to `9.2.0`. Older same-major
servers remain compatible with other operations. If the new procedure is unavailable, the
attachment operation asks the user to update that workspace server instead of pasting an
unreadable local path.

## Regression coverage

The browser tests mount the real terminal pane and xterm, dispatch clipboard/drop events, and
observe terminal input. They first failed against the original implementation because no remote
transfer was requested. Local image and text-paste controls passed in the same red run.
An additional red-green case delays the native clipboard read until after a DOM paste's upload
has finished; this caught and fixed a second upload of the same image. The suite also covers
unmount, pane replacement, read-only transitions, local paste, and workspace-tree drops.

Controller tests first failed with an unknown `prepareAttachments` procedure. They cover Host
routing, ordering, byte forwarding, source limits, batch rollback, cancellation, identity changes,
and older servers. Files-runtime tests exercise actual files and the Wire endpoint, including
partial-write failures, real byte limits, permissions, cancellation, and expiry. These layers
protect the complete behavior that the original path-formatting tests could not detect.

A gateway integration test uses two real files runtimes over Wire to verify exact binary bytes,
destination allocation outside the worktree, and readability after both runtimes stop. The
maintainer also manually verified the remote terminal behavior.

Focused regression commands, run from the repository root:

```bash
pnpm --filter @emdash/core test -- src/runtimes/files src/workspace-server
pnpm --filter @emdash/emdash-desktop test -- --project node src/core/features/terminals/node/prepare-attachments.test.ts src/core/features/terminals/node/wire-controller.test.ts src/main/gateway/terminal-attachments.integration.test.ts src/renderer/tests/terminal-image-injection.test.ts src/renderer/tests/terminalKeybindings.test.ts
pnpm --filter @emdash/emdash-desktop test -- --project browser src/renderer/tests/browser/terminal-attachments.test.tsx src/renderer/tests/browser/terminal-option-arrows.test.tsx
pnpm --filter @emdash/workspace-server test -- src/api/controller.test.ts src/wire/serve.test.ts
```
