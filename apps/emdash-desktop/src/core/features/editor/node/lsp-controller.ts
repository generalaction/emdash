import type { HostRef } from '@emdash/core/primitives/host/api';
import type { LspError, LspSessionKey } from '@emdash/core/runtimes/lsp/api';
import type { RuntimeBroker, HostRuntimesClient } from '@emdash/core/services/runtime-broker/api';
import { err, type Result } from '@emdash/shared';
import type { ContractImpl } from '@emdash/wire/rpc';
import { editorLspContract, type EditorLspSessionKey } from '../api/lsp-contract';

export interface EditorLspControllerOptions {
  runtimes: Pick<RuntimeBroker, 'client'>;
  isSupported?: (host: HostRef) => Promise<boolean>;
}

/** Adapts host identity at one boundary; documents and protocol behavior stay in Core. */
export function createEditorLspImpl(
  options: EditorLspControllerOptions,
  contract = editorLspContract
): ContractImpl<typeof editorLspContract> {
  async function resolve(key: { host: HostRef }): Promise<HostRuntimesClient['lsp']> {
    if (options.isSupported && !(await options.isSupported(key.host)))
      throw new UnsupportedLspError();
    const runtime = await options.runtimes.client(key.host);
    if (!runtime.success)
      throw new Error('The workspace host is unavailable. Reconnect to use language services.');
    return runtime.data.lsp;
  }
  async function call<T>(
    key: EditorLspSessionKey,
    run: (client: HostRuntimesClient['lsp'], session: LspSessionKey) => Promise<Result<T, LspError>>
  ): Promise<Result<T, LspError>> {
    try {
      return await run(await resolve(key), hostKey(key));
    } catch (error) {
      return err({
        type: error instanceof UnsupportedLspError ? 'unsupported' : 'request-failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    resolveProjectRoot: async ({ host, ...input }, meta) => {
      try {
        return await (await resolve({ host })).resolveProjectRoot(input, { signal: meta.signal });
      } catch (error) {
        return err({
          type: error instanceof UnsupportedLspError ? 'unsupported' : 'request-failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    applyDocumentEdit: ({ session, change }, meta) =>
      call(session, (client, key) =>
        client.applyDocumentEdit({ session: key, change }, { signal: meta.signal })
      ),
    session: {
      kind: 'liveModelProvider',
      contract: contract.session,
      resolveState: async (key, name) =>
        (await resolve(key)).session.state(hostKey(key), name).asLiveSource(),
      runMutation: async () => {
        throw new Error('Language session state is read-only');
      },
    },
    setDocumentSnapshot: ({ session, document }, meta) =>
      call(session, (client, key) =>
        client.setDocumentSnapshot({ session: key, document }, { signal: meta.signal })
      ),
    closeDocument: ({ session, path }, meta) =>
      call(session, (client, key) =>
        client.closeDocument({ session: key, path }, { signal: meta.signal })
      ),
    documentSaved: ({ session, path }, meta) =>
      call(session, (client, key) =>
        client.documentSaved({ session: key, path }, { signal: meta.signal })
      ),
    restartServer: (session, meta) =>
      call(session, (client, key) => client.restartServer(key, { signal: meta.signal })),
    hover: (input, meta) =>
      call(input.session, (client, key) =>
        client.hover({ ...input, session: key }, { signal: meta.signal })
      ),
    locations: (input, meta) =>
      call(input.session, (client, key) =>
        client.locations({ ...input, session: key }, { signal: meta.signal })
      ),
  };
}
function hostKey({ host: _host, ...key }: EditorLspSessionKey): LspSessionKey {
  return key;
}
class UnsupportedLspError extends Error {
  constructor() {
    super('Update the workspace server to use language services.');
  }
}
