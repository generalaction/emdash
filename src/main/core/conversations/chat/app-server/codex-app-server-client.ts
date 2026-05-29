import { z } from 'zod';
import type {
  CodexAppServerExitHandler,
  CodexAppServerNotificationHandler,
  CodexAppServerRequestHandler,
  CodexAppServerTransport,
} from './codex-app-server-transport';

type CodexAppServerTransportLike = {
  dispose(): Promise<void>;
  notify(method: string, params?: unknown): void;
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  setExitHandler(handler: CodexAppServerExitHandler): void;
  setNotificationHandler(handler: CodexAppServerNotificationHandler): void;
  setRequestHandler(handler: CodexAppServerRequestHandler): void;
};

const ThreadStartResponseSchema = z
  .object({
    thread: z.object({ id: z.string() }).passthrough(),
  })
  .passthrough();

const ThreadStartedNotificationSchema = z
  .object({
    thread: z.object({ id: z.string() }).passthrough(),
  })
  .passthrough();

const TurnStartedNotificationSchema = z
  .object({
    threadId: z.string().optional(),
    turn: z.object({ id: z.string() }).passthrough(),
  })
  .passthrough();

const TurnCompletedNotificationSchema = z
  .object({
    threadId: z.string().optional(),
    turn: z
      .object({
        status: z.string().optional(),
        error: z.object({ message: z.string().optional() }).nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const TextDeltaNotificationSchema = z
  .object({
    itemId: z.string(),
    delta: z.string(),
    threadId: z.string().optional(),
  })
  .passthrough();

const ItemNotificationSchema = z
  .object({
    item: z
      .object({
        id: z.string().optional(),
        type: z.string().optional(),
        status: z.string().optional(),
        name: z.string().optional(),
        title: z.string().optional(),
        text: z.string().optional(),
        output: z.string().optional(),
        error: z.union([z.string(), z.object({ message: z.string().optional() })]).optional(),
      })
      .passthrough()
      .optional(),
    itemId: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough();

export type CodexAppServerNotification =
  | { type: 'thread-started'; threadId: string }
  | { type: 'turn-started'; threadId?: string; turnId: string }
  | { type: 'turn-completed'; threadId?: string; status?: string; errorMessage?: string }
  | { type: 'assistant-delta'; itemId: string; delta: string }
  | { type: 'reasoning-delta'; itemId: string; delta: string }
  | {
      type: 'item';
      phase: 'started' | 'completed';
      itemId: string;
      itemType?: string;
      status?: string;
      name?: string;
      title?: string;
      output?: string;
      error?: string;
      raw: unknown;
    }
  | { type: 'thread-compacted' }
  | { type: 'unknown'; method: string; params: unknown };

export type CodexUserInput = {
  type: 'text';
  text: string;
  text_elements: [];
};

export type CodexSandboxPolicy =
  | { type: 'readOnly' }
  | { type: 'workspaceWrite'; networkAccess: boolean }
  | { type: 'dangerFullAccess' };

export class CodexAppServerClient {
  private readonly requestHandlers = new Map<
    string,
    (params: unknown, requestId: number) => Promise<unknown> | unknown
  >();

  constructor(private readonly transport: CodexAppServerTransportLike | CodexAppServerTransport) {
    this.transport.setRequestHandler((method, params, requestId) => {
      return this.requestHandlers.get(method)?.(params, requestId) ?? {};
    });
  }

  onNotification(callback: (notification: CodexAppServerNotification) => void): void {
    this.transport.setNotificationHandler((method, params) => {
      callback(parseNotification(method, params));
    });
  }

  onRequest(
    method: string,
    handler: (params: unknown, requestId: number) => Promise<unknown> | unknown
  ): void {
    this.requestHandlers.set(method, handler);
  }

  onExit(callback: (error: Error | undefined) => void): void {
    this.transport.setExitHandler(callback);
  }

  async initialize(): Promise<void> {
    await this.transport.request('initialize', {
      clientInfo: {
        name: 'emdash',
        title: 'Emdash',
        version: '0.0.0',
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.transport.notify('initialized', {});
  }

  async startThread(params: Record<string, unknown>): Promise<string> {
    const response = ThreadStartResponseSchema.parse(
      await this.transport.request('thread/start', params)
    );
    return response.thread.id;
  }

  async resumeThread(params: Record<string, unknown>): Promise<void> {
    await this.transport.request('thread/resume', params);
  }

  async listLoadedThreads(): Promise<string[]> {
    const response = await this.transport.request('thread/loaded/list', {});
    if (typeof response !== 'object' || response === null || !('data' in response)) {
      return [];
    }
    const data = (response as { data?: unknown }).data;
    return Array.isArray(data)
      ? data.filter((value): value is string => typeof value === 'string')
      : [];
  }

  async startTurn(params: {
    approvalPolicy: string;
    cwd: string;
    input: CodexUserInput[];
    sandboxPolicy: CodexSandboxPolicy;
    threadId: string;
  }): Promise<void> {
    await this.transport.request('turn/start', params, 90_000);
  }

  async interruptTurn(params: { threadId: string; turnId: string }): Promise<void> {
    await this.transport.request('turn/interrupt', params, 2_000);
  }

  async compactThread(threadId: string): Promise<void> {
    await this.transport.request('thread/compact/start', { threadId });
  }

  async setGoal(
    threadId: string,
    params: { objective?: string; status: 'active' | 'paused' }
  ): Promise<void> {
    await this.transport.request('thread/goal/set', { threadId, ...params });
  }

  async clearGoal(threadId: string): Promise<void> {
    await this.transport.request('thread/goal/clear', { threadId });
  }

  async dispose(): Promise<void> {
    await this.transport.dispose();
  }
}

function parseNotification(method: string, params: unknown): CodexAppServerNotification {
  if (method === 'thread/started') {
    const parsed = ThreadStartedNotificationSchema.safeParse(params);
    if (parsed.success) return { type: 'thread-started', threadId: parsed.data.thread.id };
  }
  if (method === 'turn/started') {
    const parsed = TurnStartedNotificationSchema.safeParse(params);
    if (parsed.success) {
      return {
        type: 'turn-started',
        threadId: parsed.data.threadId,
        turnId: parsed.data.turn.id,
      };
    }
  }
  if (method === 'turn/completed') {
    const parsed = TurnCompletedNotificationSchema.safeParse(params);
    if (parsed.success) {
      return {
        type: 'turn-completed',
        threadId: parsed.data.threadId,
        status: parsed.data.turn.status,
        errorMessage: parsed.data.turn.error?.message,
      };
    }
  }
  if (method === 'item/agentMessage/delta') {
    const parsed = TextDeltaNotificationSchema.safeParse(params);
    if (parsed.success) {
      return {
        type: 'assistant-delta',
        itemId: parsed.data.itemId,
        delta: parsed.data.delta,
      };
    }
  }
  if (method === 'item/reasoning/summaryTextDelta') {
    const parsed = TextDeltaNotificationSchema.safeParse(params);
    if (parsed.success) {
      return {
        type: 'reasoning-delta',
        itemId: parsed.data.itemId,
        delta: parsed.data.delta,
      };
    }
  }
  if (method === 'item/started' || method === 'item/completed') {
    const parsed = ItemNotificationSchema.safeParse(params);
    if (parsed.success) {
      const item = parsed.data.item;
      const error = item?.error;
      return {
        type: 'item',
        phase: method === 'item/started' ? 'started' : 'completed',
        itemId: item?.id ?? parsed.data.itemId ?? `${method}:${Date.now()}`,
        itemType: item?.type ?? parsed.data.type,
        status: item?.status,
        name: item?.name,
        title: item?.title,
        output: item?.output ?? item?.text,
        error:
          typeof error === 'string'
            ? error
            : typeof error?.message === 'string'
              ? error.message
              : undefined,
        raw: params,
      };
    }
  }
  if (method === 'thread/compacted') return { type: 'thread-compacted' };
  return { type: 'unknown', method, params };
}
