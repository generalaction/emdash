import { randomUUID } from 'node:crypto';
import {
  MOBILE_ACCESS_PROTOCOL_VERSION,
  mobileAccessContract,
  type MobileAccessError,
  type MobileAcpSnapshot,
  type MobileResourceHandle,
} from '@emdash/core/mobile-access';
import { err, ok, type Result, type Unsubscribe } from '@emdash/shared';
import {
  blobSourceFromBytes,
  createController,
  LiveLog,
  withValidation,
  type Controller,
} from '@emdash/wire';
import { eq } from 'drizzle-orm';
import { getAcpRuntimeClient } from '@main/core/acp/controller';
import { markConversationSeen } from '@main/core/conversations/markConversationSeen';
import { renameConversation } from '@main/core/conversations/renameConversation';
import { ptyController } from '@main/core/pty/controller';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import {
  sessionLeaseService,
  type SessionLease,
  type SessionLeaseKind,
} from '@main/core/session-leases/session-lease-service';
import { renameTerminal } from '@main/core/terminals/renameTerminal';
import { db } from '@main/db/client';
import { conversations, terminals } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { ptyDataChannel, ptyExitChannel } from '@shared/core/pty/ptyEvents';
import { buildMobileCatalog } from './catalog';
import { createMobileAgent, createMobileTerminal, getMobileCreationOptions } from './creation';
import { mobileError, toMobileError } from './errors';
import {
  listMobileDiffs,
  listMobileFiles,
  readMobileDiff,
  readMobileFile,
} from './files-and-diffs';
import { getReadyTaskContext } from './task-context';

type MobileHandle = {
  public: MobileResourceHandle;
  lease: SessionLease;
  output?: LiveLog;
  unsubscribe?: Unsubscribe;
};

const MAX_MOBILE_SNAPSHOT_BYTES = 15 * 1024 * 1024;
const CREATION_REPLAY_TTL_MS = 10 * 60 * 1000;
const MAX_CREATION_REPLAYS = 1_024;

type CreatedMobileResource = { kind: SessionLeaseKind; resourceId: string };
type CreationReplay = CreatedMobileResource & { expiresAt: number; fingerprint: string };
type PendingCreation = {
  fingerprint: string;
  result: Promise<Result<CreatedMobileResource, MobileAccessError>>;
};

const creationReplays = new Map<string, CreationReplay>();
const pendingCreations = new Map<string, PendingCreation>();

export type MobileDomainSession = {
  controller: Controller;
  dispose(): Promise<void>;
};

export function createMobileDomainSession(
  ownerId: string = randomUUID(),
  clientId: string = ownerId
): MobileDomainSession {
  const handles = new Map<string, MobileHandle>();
  const creationRequests = new Set<Promise<Result<MobileResourceHandle, MobileAccessError>>>();
  const openingResources = new Map<
    string,
    Promise<Result<MobileResourceHandle, MobileAccessError>>
  >();
  let disposed = false;

  const controller = withValidation(
    mobileAccessContract,
    createController(mobileAccessContract, {
      health: () => ({ ok: true as const, protocolVersion: MOBILE_ACCESS_PROTOCOL_VERSION }),
      initialize: ({ protocolVersion }) => {
        if (protocolVersion !== MOBILE_ACCESS_PROTOCOL_VERSION) {
          return mobileError('not_supported', 'Mobile Access protocol versions do not match');
        }
        return ok({
          protocolVersion: MOBILE_ACCESS_PROTOCOL_VERSION,
          serverName: 'Emdash Mobile Access',
          capabilities: [
            'catalog',
            'session-creation',
            'pty',
            'acp',
            'files',
            'diffs',
            'browser-links',
          ],
        });
      },
      catalog: async () => {
        try {
          return ok(await buildMobileCatalog());
        } catch (error) {
          return err(toMobileError(error));
        }
      },
      creationOptions: ({ taskId }) => getMobileCreationOptions(taskId),
      createAgent: (input) =>
        trackCreationRequest(async () => {
          const created = await runIdempotentCreation(
            clientId,
            input.requestId,
            creationFingerprint('agent', input),
            async () => {
              const result = await createMobileAgent(input);
              if (!result.success) return result;
              return ok({
                kind: result.data.type === 'acp' ? 'acp' : 'conversation',
                resourceId: result.data.id,
              });
            }
          );
          return created.success
            ? await openResource(created.data.kind, created.data.resourceId)
            : created;
        }),
      createTerminal: (input) =>
        trackCreationRequest(async () => {
          const created = await runIdempotentCreation(
            clientId,
            input.requestId,
            creationFingerprint('terminal', input),
            async () => {
              const result = await createMobileTerminal(input);
              return result.success
                ? ok({ kind: 'terminal' as const, resourceId: result.data.id })
                : result;
            }
          );
          return created.success
            ? await openResource(created.data.kind, created.data.resourceId)
            : created;
        }),
      openResource: ({ kind, resourceId }) => openResource(kind, resourceId),
      closeResource: async ({ handleId }) => {
        try {
          await closeHandle(handleId);
          return ok(undefined);
        } catch (error) {
          return err(toMobileError(error));
        }
      },
      renameResource: async ({ handleId, name }) => {
        const handle = handles.get(handleId);
        if (!handle) return mobileError('not_found', 'Resource handle not found');
        try {
          if (handle.public.kind === 'terminal') {
            await renameTerminal(handle.public.resourceId, name);
          } else {
            await renameConversation(handle.public.resourceId, name);
          }
          handle.public.title = name;
          return ok(undefined);
        } catch (error) {
          return err(toMobileError(error));
        }
      },
      pty: {
        output: ({ handleId }) => handles.get(handleId)?.output ?? null,
        sendInput: ({ handleId, data }) => {
          const handle = handles.get(handleId);
          if (!handle?.lease.sessionId || !handle.output) {
            return mobileError('not_found', 'PTY handle not found');
          }
          const result = ptyController.sendInput(handle.lease.sessionId, data);
          return result.success
            ? ok(undefined)
            : mobileError('not_available', 'The terminal is not running');
        },
        resize: ({ handleId, cols, rows }) => {
          const handle = handles.get(handleId);
          if (!handle?.lease.sessionId || !handle.output) {
            return mobileError('not_found', 'PTY handle not found');
          }
          if (!sessionLeaseService.canResize(handle.lease.id)) {
            return mobileError('conflict', 'Desktop currently owns terminal sizing');
          }
          const result = ptyController.resize(handle.lease.sessionId, cols, rows);
          return result.success
            ? ok(undefined)
            : mobileError('not_available', 'The terminal is not running');
        },
      },
      acp: {
        snapshot: async ({ handleId, before }) => {
          const resolved = resolveAcpHandle(handleId);
          if (!resolved.success) return resolved;
          try {
            const client = await getAcpRuntimeClient();
            const conversationId = resolved.data.public.resourceId;
            const key = { conversationId };
            const [
              history,
              state,
              config,
              usage,
              plan,
              agents,
              activeTurn,
              terminalStates,
              draftState,
            ] = await Promise.all([
              client.getHistory({ conversationId, before, limit: 25 }),
              client.session.state(key, 'state').snapshot(),
              client.session.state(key, 'config').snapshot(),
              client.session.state(key, 'usage').snapshot(),
              client.session.state(key, 'plan').snapshot(),
              client.session.state(key, 'agents').snapshot(),
              client.session.state(key, 'activeTurn').snapshot(),
              client.session.state(key, 'terminals').snapshot(),
              client.getPromptDraftState({ conversationId }),
            ]);
            if (!history.success) return mobileError('runtime_error', 'ACP history is unavailable');
            if (!draftState.success) {
              return mobileError('runtime_error', resultMessage(draftState.error));
            }
            const snapshot: MobileAcpSnapshot = {
              history: history.data,
              state: state.data,
              config: config.data,
              usage: usage.data,
              plan: plan.data,
              agents: agents.data,
              activeTurn: activeTurn.data,
              draftRev: draftState.data.rev,
              draft: draftState.data.draft,
              terminals: terminalStates.data,
            };
            if (encodedJsonSize(snapshot) > MAX_MOBILE_SNAPSHOT_BYTES) {
              return mobileError(
                'too_large',
                'This conversation page is too large to display on mobile'
              );
            }
            return ok(snapshot);
          } catch (error) {
            return err(toMobileError(error));
          }
        },
        sendPrompt: ({ handleId, prompt }) =>
          withAcp(handleId, (client, conversationId) =>
            client.sendPrompt({ conversationId, prompt })
          ),
        queuePrompt: ({ handleId, prompt }) =>
          withAcp(handleId, (client, conversationId) =>
            client.queuePrompt({ conversationId, prompt })
          ),
        editQueuedPrompt: ({ handleId, id, input }) =>
          withAcp(handleId, (client, conversationId) =>
            client.editQueuedPrompt({ conversationId, id, input })
          ),
        deleteQueuedPrompt: ({ handleId, id }) =>
          withAcp(handleId, (client, conversationId) =>
            client.deleteQueuedPrompt({ conversationId, id })
          ),
        reorderQueuedPrompts: ({ handleId, ids }) =>
          withAcp(handleId, (client, conversationId) =>
            client.changeQueuePromptOrder({ conversationId, ids })
          ),
        cancel: ({ handleId }) =>
          withAcp(handleId, (client, conversationId) => client.cancelTurn({ conversationId })),
        resolvePermission: ({ handleId, decision }) =>
          withAcp(handleId, (client, conversationId) =>
            client.resolvePermission({ conversationId, ...decision })
          ),
        setConfig: ({ handleId, dimension, value }) =>
          withAcp(handleId, (client, conversationId) =>
            dimension === 'mode'
              ? client.setModeOption({ conversationId, value })
              : client.setModelOption({ conversationId, dimension, value })
          ),
        setDraft: async ({ handleId, expectedRev, input }) => {
          const resolved = resolveAcpHandle(handleId);
          if (!resolved.success) return resolved;
          try {
            const client = await getAcpRuntimeClient();
            const conversationId = resolved.data.public.resourceId;
            const updated = await client.compareAndSetPromptDraft({
              conversationId,
              expectedRev,
              input,
            });
            if (!updated.success) {
              if (updated.error.type === 'prompt_draft_conflict') {
                return ok({
                  status: 'conflict' as const,
                  rev: updated.error.current.rev,
                  draft: updated.error.current.draft,
                });
              }
              return mobileError('runtime_error', resultMessage(updated.error));
            }
            return ok({
              status: 'applied' as const,
              rev: updated.data.rev,
              draft: updated.data.draft,
            });
          } catch (error) {
            return err(toMobileError(error));
          }
        },
        exportTranscript: async ({ handleId, format }) => {
          const resolved = resolveAcpHandle(handleId);
          if (!resolved.success) return resolved;
          try {
            const client = await getAcpRuntimeClient();
            const conversationId = resolved.data.public.resourceId;
            const exported =
              format === 'raw'
                ? await client.exportRawAcpLog({ conversationId })
                : await client.exportACPTranscript({ conversationId });
            if (!exported.success) {
              return mobileError('runtime_error', resultMessage(exported.error));
            }
            const content = new TextEncoder().encode(exported.data);
            return ok({
              meta: {
                name: `${conversationId}-${format === 'raw' ? 'acp-raw' : 'transcript'}.json`,
                mimeType: 'application/json',
                size: content.byteLength,
              },
              source: blobSourceFromBytes(content),
            });
          } catch (error) {
            return err(toMobileError(error));
          }
        },
        uploadAttachment: async ({ handleId }, file) => {
          const resolved = resolveAcpHandle(handleId);
          if (!resolved.success) return resolved;
          if ((file.size ?? 0) > 10 * 1024 * 1024) {
            return mobileError('too_large', 'Attachments are limited to 10 MiB');
          }
          try {
            const client = await getAcpRuntimeClient();
            const uploaded = await client.uploadAttachment(
              {},
              {
                name: file.name,
                mimeType: file.mimeType,
                size: file.size,
                source: file.stream(),
              }
            );
            return uploaded.success
              ? ok(uploaded.data)
              : mobileError('runtime_error', resultMessage(uploaded.error));
          } catch (error) {
            return err(toMobileError(error));
          }
        },
        deleteAttachment: ({ handleId, attachmentId }) =>
          withAcp(handleId, (client) => client.deleteAttachment({ id: attachmentId })),
      },
      files: {
        list: ({ taskId, path }) => listMobileFiles(taskId, path),
        read: ({ taskId, path }) => readMobileFile(taskId, path),
      },
      diffs: {
        list: ({ taskId }) => listMobileDiffs(taskId),
        read: ({ taskId, path, staged }) => readMobileDiff(taskId, path, staged),
      },
    }),
    'inputs'
  );

  async function openResource(
    kind: SessionLeaseKind,
    resourceId: string
  ): Promise<Result<MobileResourceHandle, MobileAccessError>> {
    if (disposed) return mobileError('not_available', 'Mobile connection is closed');
    const existing = [...handles.values()].find(
      (handle) => handle.public.kind === kind && handle.public.resourceId === resourceId
    );
    if (existing) return ok(existing.public);

    const key = `${kind}:${resourceId}`;
    const pending = openingResources.get(key);
    if (pending) return await pending;

    const opening = openResourceOnce(kind, resourceId).finally(() => {
      openingResources.delete(key);
    });
    openingResources.set(key, opening);
    return await opening;
  }

  async function openResourceOnce(
    kind: SessionLeaseKind,
    resourceId: string
  ): Promise<Result<MobileResourceHandle, MobileAccessError>> {
    let lease: SessionLease | undefined;
    let unsubscribe: Unsubscribe | undefined;
    try {
      const resource = await resolveResource(kind, resourceId);
      await getReadyTaskContext(resource.taskId);
      if (disposed) return mobileError('not_available', 'Mobile connection is closed');
      lease = await sessionLeaseService.acquire({
        kind,
        projectId: resource.projectId,
        taskId: resource.taskId,
        resourceId,
        ownerType: 'mobile',
        ownerId,
      });
      if (disposed) {
        await sessionLeaseService.release(lease.id);
        return mobileError('not_available', 'Mobile connection is closed');
      }
      const handleId = randomUUID();
      const publicHandle: MobileResourceHandle = {
        id: handleId,
        kind,
        resourceId,
        title: resource.title,
      };
      const handle: MobileHandle = { public: publicHandle, lease };
      const sessionId = lease.sessionId;
      if (kind !== 'acp' && sessionId) {
        const output = new LiveLog({ maxBufferBytes: 64 * 1024 });
        const retained = ptySessionRegistry.subscribe(sessionId);
        output.append(retained);
        const offData = events.on(ptyDataChannel, (chunk) => output.append(chunk), sessionId);
        const offExit = events.on(
          ptyExitChannel,
          (info) => output.append(`\r\n[Process exited with code ${info.exitCode}]\r\n`),
          sessionId
        );
        handle.output = output;
        unsubscribe = () => {
          offData();
          offExit();
          ptySessionRegistry.unsubscribe(sessionId);
        };
        handle.unsubscribe = unsubscribe;
      }
      handles.set(handleId, handle);
      if (kind !== 'terminal') {
        void markConversationSeen(resourceId).catch((error: unknown) => {
          log.warn('Failed to mark a mobile conversation as seen', { error, resourceId });
        });
      }
      return ok(publicHandle);
    } catch (error) {
      unsubscribe?.();
      if (lease) {
        try {
          await sessionLeaseService.release(lease.id);
        } catch (releaseError) {
          log.warn('Failed to roll back a mobile resource lease', {
            error: releaseError,
            resourceId,
          });
        }
      }
      return err(toMobileError(error));
    }
  }

  function trackCreationRequest(
    operation: () => Promise<Result<MobileResourceHandle, MobileAccessError>>
  ): Promise<Result<MobileResourceHandle, MobileAccessError>> {
    const request = operation().finally(() => {
      creationRequests.delete(request);
    });
    creationRequests.add(request);
    return request;
  }

  async function closeHandle(handleId: string): Promise<void> {
    const handle = handles.get(handleId);
    if (!handle) return;
    await sessionLeaseService.release(handle.lease.id);
    if (handles.get(handleId) !== handle) return;
    handles.delete(handleId);
    handle.unsubscribe?.();
  }

  function resolveAcpHandle(handleId: string): Result<MobileHandle, MobileAccessError> {
    const handle = handles.get(handleId);
    if (!handle || handle.public.kind !== 'acp') {
      return mobileError('not_found', 'ACP resource handle not found');
    }
    return ok(handle);
  }

  async function withAcp<T>(
    handleId: string,
    operation: (
      client: Awaited<ReturnType<typeof getAcpRuntimeClient>>,
      conversationId: string
    ) => Promise<Result<T, unknown>>
  ): Promise<Result<T, MobileAccessError>> {
    const resolved = resolveAcpHandle(handleId);
    if (!resolved.success) return resolved;
    try {
      const client = await getAcpRuntimeClient();
      const result = await operation(client, resolved.data.public.resourceId);
      return result.success
        ? ok(result.data)
        : mobileError('runtime_error', resultMessage(result.error));
    } catch (error) {
      return err(toMobileError(error));
    }
  }

  return {
    controller,
    async dispose() {
      if (disposed) return;
      disposed = true;
      controller.dispose?.();
      await Promise.allSettled([...creationRequests]);
      await Promise.allSettled([...openingResources.values()]);
      await Promise.allSettled([...handles.keys()].map((handleId) => closeHandle(handleId)));
      let releaseError: unknown;
      try {
        await sessionLeaseService.releaseOwner('mobile', ownerId);
      } catch (error) {
        releaseError = error;
      } finally {
        for (const handle of handles.values()) handle.unsubscribe?.();
        handles.clear();
      }
      if (releaseError !== undefined) throw releaseError;
    },
  };
}

async function resolveResource(kind: SessionLeaseKind, resourceId: string) {
  if (kind === 'terminal') {
    const [terminal] = await db
      .select()
      .from(terminals)
      .where(eq(terminals.id, resourceId))
      .limit(1);
    if (!terminal) throw new Error('Terminal not found');
    return {
      projectId: terminal.projectId,
      taskId: terminal.taskId,
      title: terminal.name,
    };
  }
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, resourceId))
    .limit(1);
  if (!conversation) throw new Error('Conversation not found');
  const actual = conversation.type === 'acp' ? 'acp' : 'conversation';
  if (actual !== kind) throw new Error('Conversation interface does not match');
  return {
    projectId: conversation.projectId,
    taskId: conversation.taskId,
    title: conversation.title,
  };
}

function resultMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; cause?: { message?: unknown }; type?: unknown };
    if (typeof value.message === 'string') return value.message;
    if (typeof value.cause?.message === 'string') return value.cause.message;
    if (typeof value.type === 'string') return value.type;
  }
  return String(error);
}

function encodedJsonSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

async function runIdempotentCreation(
  clientId: string,
  requestId: string,
  fingerprint: string,
  operation: () => Promise<Result<CreatedMobileResource, MobileAccessError>>
): Promise<Result<CreatedMobileResource, MobileAccessError>> {
  const now = Date.now();
  pruneCreationReplays(now);
  const key = `${clientId}:${requestId}`;
  const replay = creationReplays.get(key);
  if (replay && replay.expiresAt > now) {
    if (replay.fingerprint !== fingerprint) {
      return mobileError('conflict', 'This creation request ID was already used');
    }
    return ok({ kind: replay.kind, resourceId: replay.resourceId });
  }
  const pending = pendingCreations.get(key);
  if (pending) {
    return pending.fingerprint === fingerprint
      ? await pending.result
      : mobileError('conflict', 'This creation request ID is already in use');
  }

  const created = operation()
    .then((result) => {
      if (result.success) {
        creationReplays.set(key, {
          ...result.data,
          expiresAt: Date.now() + CREATION_REPLAY_TTL_MS,
          fingerprint,
        });
      }
      return result;
    })
    .finally(() => {
      pendingCreations.delete(key);
    });
  pendingCreations.set(key, { fingerprint, result: created });
  return await created;
}

function creationFingerprint(kind: 'agent' | 'terminal', input: object): string {
  const entries = Object.entries({ kind, ...input })
    .filter(([key, value]) => key !== 'requestId' && value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(entries);
}

function pruneCreationReplays(now: number): void {
  for (const [key, replay] of creationReplays) {
    if (replay.expiresAt <= now) creationReplays.delete(key);
  }
  while (creationReplays.size >= MAX_CREATION_REPLAYS) {
    const oldest = creationReplays.keys().next().value;
    if (oldest === undefined) return;
    creationReplays.delete(oldest);
  }
}
