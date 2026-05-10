import http from 'node:http';
import { ZodError, type ZodType } from 'zod';
import type { Conversation } from '@shared/conversations';
import { getConversationById } from '@main/core/conversations/getConversationById';
import { log } from '@main/lib/logger';
import { DevServerTracker } from './dev-server-tracker';
import { AgentEventBuffer } from './event-buffer';
import type { McpInternalInstance } from './instance';
import {
  FetchQuerySchema,
  handleAgentFetch,
  handleAgentInterrupt,
  handleAgentListPeers,
  handleAgentObserve,
  handleAgentSelf,
  handleAgentSend,
  handleAgentSpawn,
  InterruptBodySchema,
  ObserveQuerySchema,
  ScopeSchema,
  SendBodySchema,
  SpawnBodySchema,
} from './routes/agent';
import {
  handleProjectList,
  handleTaskCreate,
  handleTaskList,
  handleTerminalCreate,
  handleTerminalList,
  handleTerminalSend,
  handleWorkspaceDevServers,
  ProjectListQuerySchema,
  TaskCreateBodySchema,
  TaskListQuerySchema,
  TerminalCreateBodySchema,
  TerminalSendBodySchema,
} from './routes/orchestration';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export interface CallerContext {
  conversation: Conversation;
}

const HEADER_TOKEN = 'authorization';
const HEADER_INSTANCE = 'x-emdash-instance-id';
const HEADER_SESSION = 'x-emdash-session-id';
const MAX_BODY_BYTES = 1_000_000;

const AGENT_OBSERVE_RE = /^\/agent\/([^/]+)\/observe$/;
const AGENT_SEND_RE = /^\/agent\/([^/]+)\/send$/;
const AGENT_FETCH_RE = /^\/agent\/([^/]+)\/fetch$/;
const AGENT_INTERRUPT_RE = /^\/agent\/([^/]+)\/interrupt$/;
const TERMINAL_SEND_RE = /^\/terminals\/([^/]+)\/send$/;

function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const msg = r.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
  throw new HttpError(400, msg);
}

export class McpInternalHttpServer {
  private server: http.Server | null = null;
  private port = 0;
  private readonly buffer = new AgentEventBuffer();
  private readonly devServers = new DevServerTracker();

  constructor(private readonly instance: McpInternalInstance) {}

  async start(): Promise<{ port: number }> {
    if (this.server) return { port: this.port };

    this.buffer.start();
    this.devServers.start();

    this.server = http.createServer((req, res) => {
      void this.handle(req, res).catch((err) => {
        log.warn('mcp-internal: unhandled error', { error: String(err) });
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal' }));
        }
      });
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') this.port = addr.port;
        log.info('mcp-internal: listening', { port: this.port });
        resolve({ port: this.port });
      });
      this.server!.on('error', (err) => {
        log.error('mcp-internal: failed to start', { error: String(err) });
        reject(err);
      });
    });
  }

  stop(): void {
    this.buffer.stop();
    this.devServers.stop();
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = 0;
    }
  }

  getPort(): number {
    return this.port;
  }

  getStatusUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const caller = await this.authenticate(req);
      const url = req.url ?? '';
      const method = req.method ?? 'GET';

      const path = url.split('?')[0];
      const params = new URL(url, 'http://x').searchParams;

      if (method === 'GET' && path === '/agent/self') {
        return this.send(res, 200, await handleAgentSelf(caller));
      }

      if (method === 'GET' && path === '/agent/peers') {
        const scope = parseOrThrow(ScopeSchema, params.get('scope') ?? 'task');
        return this.send(res, 200, await handleAgentListPeers(caller, scope, this.buffer));
      }

      if (method === 'POST' && path === '/agent/spawn') {
        const body = parseOrThrow(SpawnBodySchema, await this.readJson(req));
        return this.send(res, 200, await handleAgentSpawn(caller, body));
      }

      const observeMatch = path.match(AGENT_OBSERVE_RE);
      if (observeMatch && method === 'GET') {
        const target = decodeURIComponent(observeMatch[1]);
        const query = parseOrThrow(ObserveQuerySchema, {
          waitForChange: params.get('waitForChange') === 'true' || undefined,
          timeoutMs: params.has('timeoutMs') ? Number(params.get('timeoutMs')) : undefined,
        });
        return this.send(res, 200, await handleAgentObserve(caller, target, query, this.buffer));
      }

      const sendMatch = path.match(AGENT_SEND_RE);
      if (sendMatch && method === 'POST') {
        const target = decodeURIComponent(sendMatch[1]);
        const body = parseOrThrow(SendBodySchema, await this.readJson(req));
        return this.send(res, 200, await handleAgentSend(caller, target, body));
      }

      const fetchMatch = path.match(AGENT_FETCH_RE);
      if (fetchMatch && method === 'GET') {
        const target = decodeURIComponent(fetchMatch[1]);
        const query = parseOrThrow(FetchQuerySchema, {
          kind: params.get('kind') ?? undefined,
          limit: params.has('limit') ? Number(params.get('limit')) : undefined,
          since: params.get('since') ?? undefined,
        });
        return this.send(res, 200, await handleAgentFetch(caller, target, query, this.buffer));
      }

      const interruptMatch = path.match(AGENT_INTERRUPT_RE);
      if (interruptMatch && method === 'POST') {
        const target = decodeURIComponent(interruptMatch[1]);
        const body = parseOrThrow(InterruptBodySchema, await this.readJson(req));
        return this.send(res, 200, await handleAgentInterrupt(caller, target, body));
      }

      if (method === 'GET' && path === '/projects') {
        const query = parseOrThrow(ProjectListQuerySchema, {
          includeArchived: params.get('includeArchived') === 'true' || undefined,
        });
        return this.send(res, 200, await handleProjectList(caller, query));
      }

      if (method === 'GET' && path === '/tasks') {
        const query = parseOrThrow(TaskListQuerySchema, {
          projectId: params.get('projectId') ?? undefined,
          includeArchived: params.get('includeArchived') === 'true' || undefined,
        });
        return this.send(res, 200, await handleTaskList(caller, query));
      }

      if (method === 'POST' && path === '/tasks') {
        const body = parseOrThrow(TaskCreateBodySchema, await this.readJson(req));
        return this.send(res, 200, await handleTaskCreate(caller, body));
      }

      if (method === 'GET' && path === '/workspace/dev-servers') {
        const data = handleWorkspaceDevServers(caller, this.devServers);
        return this.send(res, 200, data);
      }

      if (method === 'GET' && path === '/terminals') {
        const data = await handleTerminalList(caller);
        return this.send(res, 200, data);
      }

      if (method === 'POST' && path === '/terminals') {
        const body = parseOrThrow(TerminalCreateBodySchema, await this.readJson(req));
        return this.send(res, 200, await handleTerminalCreate(caller, body));
      }

      const terminalSendMatch = path.match(TERMINAL_SEND_RE);
      if (terminalSendMatch && method === 'POST') {
        const target = decodeURIComponent(terminalSendMatch[1]);
        const body = parseOrThrow(TerminalSendBodySchema, await this.readJson(req));
        return this.send(res, 200, await handleTerminalSend(caller, target, body));
      }

      this.send(res, 404, { error: 'not found' });
    } catch (err) {
      if (err instanceof HttpError) return this.send(res, err.status, { error: err.message });
      if (err instanceof ZodError) return this.send(res, 400, { error: err.message });
      log.warn('mcp-internal: route error', { error: String(err) });
      this.send(res, 500, { error: 'internal' });
    }
  }

  private async authenticate(req: http.IncomingMessage): Promise<CallerContext> {
    const authHeader = req.headers[HEADER_TOKEN];
    const auth = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== this.instance.token) {
      throw new HttpError(401, 'invalid token');
    }
    const instanceHeader = req.headers[HEADER_INSTANCE];
    const instanceId = Array.isArray(instanceHeader) ? instanceHeader[0] : instanceHeader;
    if (instanceId !== this.instance.instanceId) {
      throw new HttpError(401, 'instance mismatch');
    }
    const sessionHeader = req.headers[HEADER_SESSION];
    const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
    if (!sessionId) throw new HttpError(401, 'missing session');

    const conversation = await getConversationById(sessionId);
    if (!conversation) throw new HttpError(410, 'conversation gone');
    return { conversation };
  }

  private send(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private async readJson(req: http.IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buf = chunk as Buffer;
      total += buf.length;
      if (total > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
      chunks.push(buf);
    }
    if (total === 0) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new HttpError(400, 'invalid json');
    }
  }
}
