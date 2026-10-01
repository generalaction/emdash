import { createController } from '@emdash/wire/rpc';
import { lspContract } from '../api/contract';
import type { LspRuntime } from './runtime';

export function createLspController(runtime: LspRuntime) {
  return createController(lspContract, {
    resolveProjectRoot: (input) => runtime.resolveProjectRoot(input),
    applyDocumentEdit: ({ session, change }) => runtime.applyDocumentEdit(session, change),
    session: runtime.sessionHost,
    setDocumentSnapshot: ({ session, document }) => runtime.setDocumentSnapshot(session, document),
    closeDocument: ({ session, path }) => runtime.closeDocument(session, path),
    documentSaved: ({ session, path }) => runtime.documentSaved(session, path),
    restartServer: (key) => runtime.restartServer(key),
    hover: (input, meta) => runtime.hover(input, meta.signal),
    definition: (input, meta) => runtime.definition(input, meta.signal),
    typeDefinition: (input, meta) => runtime.typeDefinition(input, meta.signal),
    references: (input, meta) => runtime.references(input, meta.signal),
  });
}
