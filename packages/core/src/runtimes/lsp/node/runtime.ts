import { stat } from 'node:fs/promises';
import { err, ok, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type { LeasedLiveModelProvider } from '@emdash/wire/rpc';
import { cell, expose } from '@emdash/wire/state';
import { formatAbsolute, type HostAbsolutePath } from '#primitives/path/api';
import { lspContract } from '../api/contract';
import type {
  LspDocument,
  LspDocumentChange,
  LspError,
  LspQuery,
  LspSessionKey,
  LspProjectRootQuery,
} from '../api/schemas';
import { spawnLanguageServer, type LanguageServerLaunch } from './process-transport';
import { resolveLanguageProjectRoot } from './project-resolution';
import { documentUri, parseHover, parseLocations, projectSessionState } from './protocol-values';
import { createServerRequestHandlers } from './server-configuration';
import { LanguageServerSession, DocumentOutOfSyncError, StaleQueryError } from './server-session';

export type ResolvedLanguageServer = Omit<LanguageServerLaunch, 'cwd' | 'requestHandlers'> & {
  settings?: Record<string, unknown>;
};

/** Host-scoped sessions are leased by live-state attachments, including over SSH. */
export class LspRuntime {
  private readonly sessions = new Map<string, LanguageServerSession>();
  readonly sessionHost: LeasedLiveModelProvider<typeof lspContract.session>;

  constructor(options: {
    scope: Scope;
    resolveServer: (key: LspSessionKey) => Promise<ResolvedLanguageServer>;
    lingerMs?: number;
  }) {
    this.sessionHost = expose(
      lspContract.session,
      {
        current: (key, scope) => {
          const id = sessionId(key);
          const session = new LanguageServerSession({
            rootUri: documentUri(key.root),
            connect: async () => {
              const cwd = formatAbsolute(key.root);
              if (!(await stat(cwd)).isDirectory())
                throw new Error('Language server workspace root must be a directory');
              const launch = await options.resolveServer(key);
              return spawnLanguageServer({
                ...launch,
                cwd,
                requestHandlers: createServerRequestHandlers(
                  documentUri(key.root),
                  launch.settings
                ),
              });
            },
            onState: (state) => current.set(projectSessionState(state)),
          });
          const current = cell(projectSessionState(session.current));
          this.sessions.set(id, session);
          scope.add(async () => {
            if (this.sessions.get(id) === session) this.sessions.delete(id);
            await session.dispose();
          });
          void session.start().catch(() => {
            /* Failure is retained in the live state. */
          });
          return current;
        },
      },
      { scope: options.scope.child('lsp-sessions'), lingerMs: options.lingerMs ?? 30_000 }
    );
  }

  get sessionCount(): number {
    return this.sessions.size;
  }
  async resolveProjectRoot(
    input: LspProjectRootQuery
  ): Promise<Result<HostAbsolutePath, LspError>> {
    try {
      return ok(await resolveLanguageProjectRoot(input));
    } catch (error) {
      return err({
        type: 'request-failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  applyDocumentEdit(key: LspSessionKey, change: LspDocumentChange) {
    return this.withSession(key, (session) =>
      session.applyDocumentEdit({
        ...change,
        uri: documentUri(change.path),
      })
    );
  }
  setDocumentSnapshot(key: LspSessionKey, document: LspDocument) {
    return this.withSession(key, (session) =>
      session.setDocumentSnapshot({
        languageId: document.languageId,
        version: document.version,
        text: document.text,
        uri: documentUri(document.path),
      })
    );
  }
  closeDocument(key: LspSessionKey, path: HostAbsolutePath) {
    return this.withSession(key, (session) => session.closeDocument(documentUri(path)));
  }
  documentSaved(key: LspSessionKey, path: HostAbsolutePath) {
    return this.withSession(key, (session) => session.documentSaved(documentUri(path)));
  }
  restartServer(key: LspSessionKey) {
    return this.withSession(key, (session) => session.restartServer());
  }
  hover(input: LspQuery, signal?: AbortSignal) {
    return this.withSession(
      input.session,
      async (session) => {
        await session.start();
        if (!session.current.capabilities.hoverProvider) return null;
        return parseHover(
          await session.query(
            'textDocument/hover',
            documentUri(input.path),
            input.version,
            input.position,
            signal
          )
        );
      },
      signal
    );
  }
  definition(input: LspQuery, signal?: AbortSignal) {
    return this.findLocations(input, 'definition', signal);
  }
  typeDefinition(input: LspQuery, signal?: AbortSignal) {
    return this.findLocations(input, 'typeDefinition', signal);
  }
  references(input: LspQuery & { includeDeclaration: boolean }, signal?: AbortSignal) {
    return this.findLocations(input, 'references', signal, {
      includeDeclaration: input.includeDeclaration,
    });
  }
  private findLocations(
    input: LspQuery,
    kind: 'definition' | 'typeDefinition' | 'references',
    signal?: AbortSignal,
    context?: { includeDeclaration: boolean }
  ) {
    return this.withSession(
      input.session,
      async (session) => {
        await session.start();
        if (!session.current.capabilities[`${kind}Provider`]) return [];
        return parseLocations(
          await session.query(
            `textDocument/${kind}`,
            documentUri(input.path),
            input.version,
            input.position,
            signal,
            context
          )
        );
      },
      signal
    );
  }
  private async withSession<T>(
    key: LspSessionKey,
    run: (session: LanguageServerSession) => Promise<T>,
    signal?: AbortSignal
  ): Promise<Result<T, LspError>> {
    const session = this.sessions.get(sessionId(key));
    if (!session)
      return err({
        type: 'session-unavailable',
        message: 'Attach language services before using this session.',
      });
    try {
      signal?.throwIfAborted();
      return ok(await run(session));
    } catch (error) {
      return err({
        type: signal?.aborted
          ? 'cancelled'
          : error instanceof DocumentOutOfSyncError
            ? 'document-out-of-sync'
            : error instanceof StaleQueryError
              ? 'stale-query'
              : 'request-failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function sessionId(key: LspSessionKey): string {
  return JSON.stringify([key.clientId, key.serverId, formatAbsolute(key.root)]);
}
