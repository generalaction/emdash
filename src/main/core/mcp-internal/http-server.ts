import http from 'node:http';
import { ZodError, type ZodType } from 'zod';
import { getConversationById } from '@main/core/conversations/getConversationById';
import { log } from '@main/lib/logger';
import type { Conversation } from '@shared/conversations';
import type { McpInternalInstance } from './instance';
import {
  handleAgentInterrupt,
  handleAgentListPeers,
  handleAgentSelf,
  handleAgentSend,
  handleAgentSpawn,
  InterruptBodySchema,
  ScopeSchema,
  SendBodySchema,
  SpawnBodySchema,
} from './routes/agent';

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
const AGENT_SEND_RE = /^\/agent\/([^/]+)\/send$/;
const AGENT_INTERRUPT_RE = /^\/agent\/([^/]+)\/interrupt$/;

function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const message = result.error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
  throw new HttpError(400, message);
}

export class McpInternalHttpServer {
  private server: http.Server | null = null;
  private port = 0;

  constructor(private readonly instance: McpInternalInstance) {}

  async start(): Promise<{ port: number }> {
    if (this.server) return { port: this.port };

    this.server = http.createServer((req, res) => {
      void this.handle(req, res).catch((error) => {
        log.warn('mcp-internal: unhandled error', { error: String(error) });
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal' }));
        }
      });
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        if (address && typeof address === 'object') this.port = address.port;
        log.info('mcp-internal: listening', { port: this.port });
        resolve({ port: this.port });
      });
      this.server!.on('error', reject);
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.port = 0;
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
        return this.send(res, 200, await handleAgentListPeers(caller, scope));
      }

      if (method === 'POST' && path === '/agent/spawn') {
        const body = parseOrThrow(SpawnBodySchema, await this.readJson(req));
        return this.send(res, 200, await handleAgentSpawn(caller, body));
      }

      const sendMatch = path.match(AGENT_SEND_RE);
      if (sendMatch && method === 'POST') {
        const body = parseOrThrow(SendBodySchema, await this.readJson(req));
        return this.send(
          res,
          200,
          await handleAgentSend(caller, decodeURIComponent(sendMatch[1]), body)
        );
      }

      const interruptMatch = path.match(AGENT_INTERRUPT_RE);
      if (interruptMatch && method === 'POST') {
        const body = parseOrThrow(InterruptBodySchema, await this.readJson(req));
        return this.send(
          res,
          200,
          await handleAgentInterrupt(caller, decodeURIComponent(interruptMatch[1]), body)
        );
      }

      this.send(res, 404, { error: 'not found' });
    } catch (error) {
      if (error instanceof HttpError) return this.send(res, error.status, { error: error.message });
      if (error instanceof ZodError) return this.send(res, 400, { error: error.message });
      log.warn('mcp-internal: route error', { error: String(error) });
      this.send(res, 500, { error: 'internal' });
    }
  }

  private async authenticate(req: http.IncomingMessage): Promise<CallerContext> {
    const authHeader = req.headers[HEADER_TOKEN];
    const auth = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (!auth?.startsWith('Bearer ') || auth.slice(7) !== this.instance.token) {
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
      const buffer = chunk as Buffer;
      total += buffer.length;
      if (total > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
      chunks.push(buffer);
    }
    if (total === 0) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new HttpError(400, 'invalid json');
    }
  }
}
