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

const CodexModelListResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            id: z.string(),
            displayName: z.string().optional(),
            description: z.string().optional(),
            isDefault: z.boolean().optional(),
            model: z.string().optional(),
            defaultReasoningEffort: z.string().optional(),
            supportedReasoningEfforts: z
              .array(
                z
                  .object({
                    reasoningEffort: z.string().optional(),
                    description: z.string().optional(),
                  })
                  .passthrough()
              )
              .optional(),
          })
          .passthrough()
      )
      .optional(),
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

const TurnPlanUpdatedNotificationSchema = z
  .object({
    plan: z.array(
      z
        .object({
          step: z.string().optional(),
          status: z.string().optional(),
        })
        .passthrough()
    ),
  })
  .passthrough();

const TurnDiffUpdatedNotificationSchema = z
  .object({
    diff: z.string(),
  })
  .passthrough();

const ThreadTokenUsageUpdatedNotificationSchema = z
  .object({
    tokenUsage: z.unknown(),
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

const CodexEventNotificationSchema = z
  .object({
    msg: z
      .object({
        type: z.string(),
        call_id: z.string().optional(),
        command: z.unknown().optional(),
        cwd: z.string().optional(),
        stdout: z.string().optional(),
        stderr: z.string().optional(),
        aggregated_output: z.string().optional(),
        aggregatedOutput: z.string().optional(),
        formatted_output: z.string().optional(),
        exit_code: z.number().nullable().optional(),
        exitCode: z.number().nullable().optional(),
        success: z.boolean().optional(),
        stream: z.string().optional(),
        chunk: z.string().optional(),
        delta: z.string().optional(),
        process_id: z.union([z.string(), z.number()]).optional(),
        stdin: z.string().optional(),
        changes: z.unknown().optional(),
        unified_diff: z.string().optional(),
        diff: z.string().optional(),
        reason: z.string().optional(),
        item: z
          .object({
            id: z.string().optional(),
            type: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
    threadId: z.string().optional(),
  })
  .passthrough();

const TerminalInteractionNotificationSchema = z
  .object({
    itemId: z.string().optional(),
    processId: z.union([z.string(), z.number()]).optional(),
    stdin: z.string().optional(),
  })
  .passthrough();

const FileChangeOutputDeltaNotificationSchema = z
  .object({
    itemId: z.string(),
    delta: z.string().optional(),
    chunk: z.string().optional(),
  })
  .passthrough();

export type CodexAppServerNotification =
  | { type: 'thread-started'; threadId: string }
  | { type: 'turn-started'; threadId?: string; turnId: string }
  | { type: 'turn-completed'; threadId?: string; status?: string; errorMessage?: string }
  | { type: 'plan-updated'; plan: Array<{ step?: string; status?: string }> }
  | { type: 'diff-updated'; diff: string }
  | { type: 'token-usage-updated'; tokenUsage: unknown }
  | { type: 'assistant-delta'; itemId: string; delta: string }
  | { type: 'reasoning-delta'; itemId: string; delta: string }
  | {
      type: 'exec-command';
      phase: 'started' | 'completed';
      callId?: string;
      command?: unknown;
      cwd?: string;
      output?: string;
      stderr?: string;
      exitCode?: number | null;
      success?: boolean;
      raw: unknown;
    }
  | { type: 'exec-command-output-delta'; callId?: string; stream?: string; delta?: string }
  | {
      type: 'terminal-interaction';
      callId?: string;
      processId?: string;
      stdin?: string;
      raw: unknown;
    }
  | {
      type: 'patch-apply';
      phase: 'started' | 'completed';
      callId?: string;
      changes?: unknown;
      stdout?: string;
      stderr?: string;
      success?: boolean;
      raw: unknown;
    }
  | { type: 'file-change-output-delta'; itemId: string; delta?: string }
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

export type CodexUserInput =
  | {
      type: 'text';
      text: string;
      text_elements: [];
    }
  | {
      type: 'skill';
      name: string;
      path: string;
    };

export type CodexSkill = {
  name: string;
  description: string;
  enabled?: boolean;
  path: string;
};

export type CodexModel = {
  id: string;
  displayName?: string;
  description?: string;
  isDefault?: boolean;
  model?: string;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<{
    reasoningEffort?: string;
    description?: string;
  }>;
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

  async listSkills(cwd: string): Promise<CodexSkill[]> {
    const response = await this.transport.request('skills/list', { cwd: [cwd] }, 10_000);
    const data =
      typeof response === 'object' && response !== null && 'data' in response
        ? (response as { data?: unknown }).data
        : undefined;
    if (!Array.isArray(data)) return [];

    const skillsByName = new Map<string, CodexSkill>();
    for (const entry of data) {
      const skills =
        typeof entry === 'object' && entry !== null && 'skills' in entry
          ? (entry as { skills?: unknown }).skills
          : undefined;
      if (!Array.isArray(skills)) continue;
      for (const skill of skills) {
        if (typeof skill !== 'object' || skill === null) continue;
        const record = skill as Record<string, unknown>;
        if (typeof record.name !== 'string' || typeof record.path !== 'string') continue;
        if (skillsByName.has(record.name)) continue;
        skillsByName.set(record.name, {
          name: record.name,
          description: resolveSkillDescription(record),
          enabled: typeof record.enabled === 'boolean' ? record.enabled : undefined,
          path: record.path,
        });
      }
    }
    return Array.from(skillsByName.values());
  }

  async listModels(): Promise<CodexModel[]> {
    const response = CodexModelListResponseSchema.parse(
      await this.transport.request('model/list', {}, 10_000)
    );
    return response.data ?? [];
  }

  async startTurn(params: {
    approvalPolicy: string;
    cwd: string;
    effort?: string;
    input: CodexUserInput[];
    model?: string;
    sandboxPolicy: CodexSandboxPolicy;
    serviceTier?: 'fast';
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

function resolveSkillDescription(skill: Record<string, unknown>): string {
  if (typeof skill.description === 'string') return skill.description;
  if (typeof skill.shortDescription === 'string') return skill.shortDescription;
  return 'Skill';
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
  if (method === 'turn/plan/updated') {
    const parsed = TurnPlanUpdatedNotificationSchema.safeParse(params);
    if (parsed.success) {
      return {
        type: 'plan-updated',
        plan: parsed.data.plan.map((entry) => ({
          step: entry.step,
          status: entry.status,
        })),
      };
    }
  }
  if (method === 'turn/diff/updated') {
    const parsed = TurnDiffUpdatedNotificationSchema.safeParse(params);
    if (parsed.success) return { type: 'diff-updated', diff: parsed.data.diff };
  }
  if (method === 'thread/tokenUsage/updated') {
    const parsed = ThreadTokenUsageUpdatedNotificationSchema.safeParse(params);
    if (parsed.success) {
      return { type: 'token-usage-updated', tokenUsage: parsed.data.tokenUsage };
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
  if (method.startsWith('codex/event/')) {
    const parsed = CodexEventNotificationSchema.safeParse(params);
    if (parsed.success) {
      const msg = parsed.data.msg;
      if (method === 'codex/event/item_started' && msg.item) {
        return parseItemLifecycle('started', params, msg.item, parsed.data.threadId);
      }
      if (method === 'codex/event/item_completed' && msg.item) {
        return parseItemLifecycle('completed', params, msg.item, parsed.data.threadId);
      }
      if (method === 'codex/event/exec_command_begin') {
        return {
          type: 'exec-command',
          phase: 'started',
          callId: msg.call_id,
          command: msg.command,
          cwd: msg.cwd,
          raw: params,
        };
      }
      if (method === 'codex/event/exec_command_end') {
        return {
          type: 'exec-command',
          phase: 'completed',
          callId: msg.call_id,
          command: msg.command,
          cwd: msg.cwd,
          output:
            msg.aggregated_output ?? msg.aggregatedOutput ?? msg.formatted_output ?? msg.stdout,
          stderr: msg.stderr,
          exitCode: msg.exit_code ?? msg.exitCode,
          success: msg.success,
          raw: params,
        };
      }
      if (method === 'codex/event/exec_command_output_delta') {
        return {
          type: 'exec-command-output-delta',
          callId: msg.call_id,
          stream: msg.stream,
          delta: msg.chunk ?? msg.delta,
        };
      }
      if (method === 'codex/event/terminal_interaction') {
        return {
          type: 'terminal-interaction',
          callId: msg.call_id,
          processId: normalizeProcessId(msg.process_id),
          stdin: msg.stdin,
          raw: params,
        };
      }
      if (method === 'codex/event/patch_apply_begin') {
        return {
          type: 'patch-apply',
          phase: 'started',
          callId: msg.call_id,
          changes: msg.changes,
          raw: params,
        };
      }
      if (method === 'codex/event/patch_apply_end') {
        return {
          type: 'patch-apply',
          phase: 'completed',
          callId: msg.call_id,
          changes: msg.changes,
          stdout: msg.stdout,
          stderr: msg.stderr,
          success: msg.success,
          raw: params,
        };
      }
      if (method === 'codex/event/turn_diff') {
        return { type: 'diff-updated', diff: msg.unified_diff ?? msg.diff ?? '' };
      }
      if (method === 'codex/event/turn_aborted') {
        return { type: 'turn-completed', status: 'interrupted' };
      }
      if (method === 'codex/event/task_complete') {
        return { type: 'turn-completed', status: 'completed' };
      }
    }
  }
  if (method === 'item/commandExecution/terminalInteraction') {
    const parsed = TerminalInteractionNotificationSchema.safeParse(params);
    if (parsed.success) {
      return {
        type: 'terminal-interaction',
        callId: parsed.data.itemId,
        processId: normalizeProcessId(parsed.data.processId),
        stdin: parsed.data.stdin,
        raw: params,
      };
    }
  }
  if (method === 'item/fileChange/outputDelta') {
    const parsed = FileChangeOutputDeltaNotificationSchema.safeParse(params);
    if (parsed.success) {
      return {
        type: 'file-change-output-delta',
        itemId: parsed.data.itemId,
        delta: parsed.data.delta ?? parsed.data.chunk,
      };
    }
  }
  if (method === 'item/started' || method === 'item/completed') {
    const parsed = ItemNotificationSchema.safeParse(params);
    if (parsed.success) {
      const item = parsed.data.item;
      return parseItemLifecycle(
        method === 'item/started' ? 'started' : 'completed',
        params,
        item,
        undefined,
        parsed.data.itemId,
        parsed.data.type
      );
    }
  }
  if (method === 'thread/compacted') return { type: 'thread-compacted' };
  return { type: 'unknown', method, params };
}

function parseItemLifecycle(
  phase: 'started' | 'completed',
  raw: unknown,
  item:
    | {
        id?: string;
        type?: string;
        status?: string;
        name?: string;
        title?: string;
        text?: string;
        output?: string;
        error?: string | { message?: string };
      }
    | undefined,
  _threadId?: string,
  itemId?: string,
  itemType?: string
): CodexAppServerNotification {
  const error = item?.error;
  return {
    type: 'item',
    phase,
    itemId: item?.id ?? itemId ?? `item:${phase}:${Date.now()}`,
    itemType: item?.type ?? itemType,
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
    raw,
  };
}

function normalizeProcessId(value: string | number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}
