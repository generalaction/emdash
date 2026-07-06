import type {
  AgentState,
  HistoryPage,
  PlanState,
  PromptDraft,
  PromptDraftUpdate,
  PromptInput,
  ResumeResult,
  SessionConfigState,
  SessionState,
  SessionSummary,
  SessionUsage,
  TerminalState,
  TranscriptTurn,
  AcpRuntimeError,
  AttachmentMimeType,
  AttachmentRef,
} from '@emdash/core/acp/client';
import type { LiveLogSnapshotData, LiveSnapshot, LiveUpdate } from '@emdash/core/live';
import type { Result } from '@emdash/shared';
import { createORPCClient, type Client } from '@orpc/client';
import { onMessagePortClose, RPCLink } from '@orpc/client/message-port';
import { rpc } from '@renderer/lib/ipc';

type Proc<I = unknown, O = unknown> = Client<Record<never, never>, I, O, unknown>;
type LiveModelEndpoint<I, T> = {
  snapshot: Proc<I, LiveSnapshot<T>>;
  subscribe: Proc<I, AsyncIterator<LiveUpdate>>;
  unsubscribe: Proc<I, void>;
};
type LiveLogEndpoint<I> = {
  snapshot: Proc<I, LiveSnapshot<LiveLogSnapshotData>>;
  subscribe: Proc<I, AsyncIterator<LiveUpdate>>;
  unsubscribe: Proc<I, void>;
};

export type AcpRuntimeRpcClient = {
  startSession: Proc<{ input: StartSessionInput }, Result<{ sessionId: string }, AcpRuntimeError>>;
  resumeSession: Proc<
    { input: StartSessionInput & { sessionId: string } },
    Result<ResumeResult, AcpRuntimeError>
  >;
  stopSession: Proc<{ conversationId: string }, Result<void, AcpRuntimeError>>;
  sendPrompt: Proc<
    { conversationId: string; prompt: PromptInput },
    Result<{ queued: boolean }, AcpRuntimeError>
  >;
  queuePrompt: Proc<
    { conversationId: string; prompt: PromptInput },
    Result<{ queued: boolean }, AcpRuntimeError>
  >;
  editQueuedPrompt: Proc<
    { conversationId: string; id: string; input: PromptInput },
    Result<void, AcpRuntimeError>
  >;
  deleteQueuedPrompt: Proc<{ conversationId: string; id: string }, Result<void, AcpRuntimeError>>;
  changeQueuePromptOrder: Proc<
    { conversationId: string; ids: string[] },
    Result<void, AcpRuntimeError>
  >;
  cancelTurn: Proc<{ conversationId: string }, Result<void, AcpRuntimeError>>;
  setPromptDraft: Proc<
    { conversationId: string; draft: PromptDraftUpdate },
    Result<void, AcpRuntimeError>
  >;
  setModelOption: Proc<
    { conversationId: string; dimension: 'model' | 'effort'; value: string },
    Result<void, AcpRuntimeError>
  >;
  setModeOption: Proc<{ conversationId: string; value: string }, Result<void, AcpRuntimeError>>;
  resolvePermission: Proc<
    { conversationId: string; requestId: string; optionId: string },
    Result<void, AcpRuntimeError>
  >;
  exportACPTranscript: Proc<{ conversationId: string }, Result<string, AcpRuntimeError>>;
  exportRawAcpLog: Proc<{ conversationId: string }, Result<string, AcpRuntimeError>>;
  uploadAttachment: Proc<
    {
      data?: Uint8Array;
      mimeType: AttachmentMimeType;
      name?: string;
      originalPath?: string;
    },
    Result<AttachmentRef, AcpRuntimeError>
  >;
  downloadAttachment: Proc<
    { id: string },
    Result<{ ref: AttachmentRef; data: Uint8Array }, AcpRuntimeError>
  >;
  deleteAttachment: Proc<{ id: string }, Result<void, AcpRuntimeError>>;
  getHistory: Proc<
    { conversationId: string; before?: number; limit: number },
    Result<HistoryPage, AcpRuntimeError>
  >;
  live: {
    sessionStateList: LiveModelEndpoint<void | undefined, Record<string, SessionSummary>>;
    sessionState: LiveModelEndpoint<{ conversationId: string }, SessionState>;
    sessionConfig: LiveModelEndpoint<{ conversationId: string }, SessionConfigState>;
    sessionUsage: LiveModelEndpoint<{ conversationId: string }, SessionUsage | null>;
    plan: LiveModelEndpoint<{ conversationId: string }, PlanState | null>;
    agents: LiveModelEndpoint<{ conversationId: string }, AgentState[]>;
    activeTurn: LiveModelEndpoint<{ conversationId: string }, TranscriptTurn | null>;
    promptDraft: LiveModelEndpoint<{ conversationId: string }, PromptDraft | null>;
    terminals: LiveModelEndpoint<{ conversationId: string }, TerminalState[]>;
    terminalOutput: LiveLogEndpoint<{ terminalId: string }>;
  };
};

export type StartSessionInput = {
  conversationId: string;
  projectId: string;
  taskId: string;
  providerId: string;
  workspaceId: string;
  cwd: string;
  sessionId?: string | null;
  model?: string | null;
  initialPrompt?: string;
};

let clientPromise: Promise<AcpRuntimeRpcClient> | null = null;

export function getAcpRuntimeClient(): Promise<AcpRuntimeRpcClient> {
  clientPromise ??= connect();
  return clientPromise;
}

export function resetAcpRuntimeClient(): void {
  clientPromise = null;
}

async function connect(): Promise<AcpRuntimeRpcClient> {
  const port = await requestRuntimePort();
  const link = new RPCLink({ port });
  const client = createORPCClient<AcpRuntimeRpcClient>(link);
  onMessagePortClose(port, () => {
    if (clientPromise) clientPromise = null;
  });
  return client;
}

async function requestRuntimePort(): Promise<MessagePort> {
  const portPromise = new Promise<MessagePort>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Timed out waiting for ACP runtime port'));
    }, 10_000);

    function onMessage(event: MessageEvent): void {
      if (!isRuntimePortMessage(event.data)) return;
      const [port] = event.ports;
      if (!port) return;
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      port.start();
      resolve(port);
    }

    window.addEventListener('message', onMessage);
  });
  await rpc.acp.requestRuntimePort();
  return portPromise;
}

function isRuntimePortMessage(value: unknown): value is {
  type: 'acp:runtime-port';
  requestId: string;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'acp:runtime-port'
  );
}
