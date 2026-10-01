import { createController } from '@emdash/wire/rpc';
import { lspContract } from '../api/contract';
import type { LspRuntime } from './runtime';

export function createLspController(runtime: LspRuntime) {
  return createController(lspContract, {
    resolveProject: (input) => runtime.resolveProject(input),
    changeDocument: ({ session, change }) => runtime.changeDocument(session, change),
    session: runtime.sessionHost,
    syncDocument: ({ session, document }) => runtime.syncDocument(session, document),
    closeDocument: ({ session, path }) => runtime.closeDocument(session, path),
    saved: ({ session, path }) => runtime.saved(session, path),
    restart: (key) => runtime.restart(key),
    hover: (input, meta) => runtime.hover(input, meta.signal),
    locations: (input, meta) => runtime.locations(input, meta.signal),
  });
}
