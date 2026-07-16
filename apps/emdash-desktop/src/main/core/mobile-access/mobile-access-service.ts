import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, relative, resolve, sep } from 'node:path';
import type { Duplex } from 'node:stream';
import { DEFAULT_MAX_WIRE_FRAME_BYTES } from '@emdash/wire';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type {
  MobileAccessBindableInterface,
  MobileAccessClient,
  MobileAccessOperationResult,
  MobileAccessPairingCode,
  MobileAccessSettings,
  MobileAccessStatus,
} from '@shared/core/mobile-access';
import {
  isBindableMobileAccessAddress,
  listBindableMobileAccessInterfaces,
  type NetworkInterfaceMap,
} from './network-addresses';

const COOKIE_NAME = 'emdash_mobile_session';
const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
const PAIRING_CODE_MAX_ATTEMPTS = 5;
const PAIRING_RATE_WINDOW_MS = 60 * 1000;
const PAIRING_RATE_MAX_ATTEMPTS = 10;
const MAX_PAIRING_BODY_BYTES = 1024;
const MAX_COOKIE_BYTES = 4096;
const MAX_WEBSOCKET_PAYLOAD_BYTES = 128 * 1024;
const MAX_BUFFERED_OUTPUT_BYTES = DEFAULT_MAX_WIRE_FRAME_BYTES;
const MAX_CONNECTIONS = 8;
const MAX_CONNECTIONS_PER_CLIENT = 2;
const HEARTBEAT_INTERVAL_MS = 30_000;
const INTERFACE_CHECK_INTERVAL_MS = 15_000;

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

type MobileAccessLogger = {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
};

type ClientRecord = {
  id: string;
  name: string;
  pairedAt: number;
  lastSeenAt: number;
  tokenHash: string;
  connections: Set<MobileAccessConnectionImpl>;
};

type PairingCodeRecord = {
  digest: Buffer;
  expiresAt: number;
  attempts: number;
};

type PairingRateRecord = {
  startedAt: number;
  attempts: number;
};

export type MobileAccessMessage = {
  data: Uint8Array;
  binary: boolean;
};

export interface AuthenticatedMobileAccessConnection {
  readonly id: string;
  readonly clientId: string;
  readonly connectedAt: number;
  send(data: string | Uint8Array): boolean;
  close(code?: number, reason?: string): void;
  onMessage(listener: (message: MobileAccessMessage) => void): () => void;
  onClose(listener: () => void): () => void;
}

export type AuthenticatedMobileAccessConnectionHandler = (
  connection: AuthenticatedMobileAccessConnection
) => void;

export type MobileAccessServiceOptions = {
  getSettings: () => Promise<MobileAccessSettings>;
  getSpaRoot: () => string;
  getNetworkInterfaces?: () => NetworkInterfaceMap;
  interfaceCheckIntervalMs?: number;
  now?: () => number;
  logger?: MobileAccessLogger;
  onStatusChanged?: (status: MobileAccessStatus) => void;
  onClientsChanged?: (clients: MobileAccessClient[]) => void;
};

class BodyTooLargeError extends Error {}

class MobileAccessConnectionImpl implements AuthenticatedMobileAccessConnection {
  readonly id = randomUUID();
  readonly connectedAt: number;
  private readonly messageListeners = new Set<(message: MobileAccessMessage) => void>();
  private readonly closeListeners = new Set<() => void>();
  private closed = false;
  isAlive = true;

  constructor(
    readonly clientId: string,
    private readonly socket: WebSocket,
    now: () => number,
    private readonly didClose: (connection: MobileAccessConnectionImpl) => void
  ) {
    this.connectedAt = now();
  }

  send(data: string | Uint8Array): boolean {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return false;
    const byteLength = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    if (this.socket.bufferedAmount + byteLength > MAX_BUFFERED_OUTPUT_BYTES) {
      this.close(1013, 'Client is too slow');
      return false;
    }

    this.socket.send(data, { binary: typeof data !== 'string' }, (error) => {
      if (error) this.close(1011, 'Send failed');
    });
    return true;
  }

  close(code = 1000, reason = 'Closed'): void {
    if (this.closed) return;
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close(code, reason);
    else this.finishClose();
  }

  terminate(): void {
    if (this.closed) return;
    this.socket.terminate();
    this.finishClose();
  }

  ping(): void {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return;
    this.isAlive = false;
    this.socket.ping();
  }

  markAlive(): void {
    this.isAlive = true;
  }

  deliver(data: RawData, binary: boolean): void {
    if (this.closed) return;
    const bytes = Array.isArray(data)
      ? Buffer.concat(data)
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    for (const listener of this.messageListeners) {
      try {
        listener({ data: bytes, binary });
      } catch {
        this.close(1011, 'Message handler failed');
      }
    }
  }

  onMessage(listener: (message: MobileAccessMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  finishClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.didClose(this);
    for (const listener of this.closeListeners) {
      try {
        listener();
      } catch {
        // Cleanup listeners are isolated from one another.
      }
    }
    this.messageListeners.clear();
    this.closeListeners.clear();
  }
}

export class MobileAccessService {
  private readonly getNetworkInterfaces: () => NetworkInterfaceMap;
  private readonly interfaceCheckIntervalMs: number;
  private readonly now: () => number;
  private readonly logger: MobileAccessLogger;
  private readonly authSecret = randomBytes(32);
  private readonly clients = new Map<string, ClientRecord>();
  private readonly clientsByTokenHash = new Map<string, ClientRecord>();
  private readonly pairRateByAddress = new Map<string, PairingRateRecord>();
  private readonly connections = new Set<MobileAccessConnectionImpl>();
  private readonly websocketServer = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: MAX_WEBSOCKET_PAYLOAD_BYTES,
    perMessageDeflate: false,
  });
  private configuredSettings: MobileAccessSettings = {
    enabled: false,
    bindAddress: null,
    port: 7458,
  };
  private runtimeState: MobileAccessStatus['state'] = 'disabled';
  private runtimeError: string | null = null;
  private activeAddress: string | null = null;
  private activePort: number | null = null;
  private pairingCode: PairingCodeRecord | null = null;
  private httpServer: Server | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private interfaceTimer: ReturnType<typeof setInterval> | null = null;
  private operationQueue: Promise<void> = Promise.resolve();
  private connectionHandler: AuthenticatedMobileAccessConnectionHandler | null = null;
  private disposed = false;

  constructor(private readonly options: MobileAccessServiceOptions) {
    this.getNetworkInterfaces = options.getNetworkInterfaces ?? networkInterfaces;
    this.interfaceCheckIntervalMs = options.interfaceCheckIntervalMs ?? INTERFACE_CHECK_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.logger = options.logger ?? console;
  }

  setAuthenticatedConnectionHandler(
    handler: AuthenticatedMobileAccessConnectionHandler | null
  ): void {
    this.connectionHandler = handler;
  }

  getStatus(): MobileAccessStatus {
    const running = this.runtimeState === 'running';
    const bindAddress = running ? this.activeAddress : this.configuredSettings.bindAddress;
    const port =
      running && this.activePort !== null ? this.activePort : this.configuredSettings.port;
    return {
      state: this.runtimeState,
      enabled: this.configuredSettings.enabled,
      bindAddress,
      port,
      url: running && bindAddress ? `http://${bindAddress}:${port}` : null,
      error: this.runtimeError,
      pairedClientCount: this.clients.size,
      activeConnectionCount: this.connections.size,
    };
  }

  listBindableInterfaces(): MobileAccessBindableInterface[] {
    return listBindableMobileAccessInterfaces(this.getNetworkInterfaces());
  }

  listClients(): MobileAccessClient[] {
    return [...this.clients.values()]
      .map((client) => this.toClientInfo(client))
      .sort((left, right) => right.pairedAt - left.pairedAt);
  }

  async initialize(): Promise<void> {
    this.disposed = false;
    await this.reconcile();
  }

  async reconcile(): Promise<void> {
    await this.enqueue(async () => {
      const settings = await this.options.getSettings();
      this.configuredSettings = settings;
      if (!settings.enabled) {
        await this.stopInternal();
        return;
      }

      if (
        !settings.bindAddress ||
        !isBindableMobileAccessAddress(settings.bindAddress, this.getNetworkInterfaces())
      ) {
        await this.stopInternal();
        this.setRuntimeState(
          'error',
          settings.bindAddress
            ? 'The selected private network address is no longer available.'
            : 'Select a private network address before enabling mobile access.'
        );
        this.startInterfaceMonitor();
        return;
      }

      if (
        this.runtimeState === 'running' &&
        this.activeAddress === settings.bindAddress &&
        this.activePort === settings.port
      ) {
        return;
      }

      await this.stopInternal();
      await this.startInternal(settings.bindAddress, settings.port);
    });
  }

  async restart(): Promise<MobileAccessOperationResult<MobileAccessStatus>> {
    return this.enqueue(async () => {
      this.configuredSettings = await this.options.getSettings();
      await this.stopInternal();
      if (!this.configuredSettings.enabled) {
        return { success: true, value: this.getStatus() };
      }
      const address = this.configuredSettings.bindAddress;
      if (!address || !isBindableMobileAccessAddress(address, this.getNetworkInterfaces())) {
        this.setRuntimeState('error', 'The selected private network address is unavailable.');
        this.startInterfaceMonitor();
        return {
          success: false,
          error: { code: 'restart_failed', message: this.runtimeError! },
        };
      }
      await this.startInternal(address, this.configuredSettings.port);
      if (this.runtimeState !== 'running') {
        return {
          success: false,
          error: {
            code: 'restart_failed',
            message: this.runtimeError ?? 'Mobile access failed to start.',
          },
        };
      }
      return { success: true, value: this.getStatus() };
    });
  }

  generatePairingCode(): MobileAccessOperationResult<MobileAccessPairingCode> {
    if (this.runtimeState !== 'running') {
      return {
        success: false,
        error: { code: 'not_running', message: 'Mobile access is not running.' },
      };
    }
    const code = String(randomInt(10_000_000, 100_000_000));
    const expiresAt = this.now() + PAIRING_CODE_TTL_MS;
    this.pairingCode = {
      digest: this.hashSecret('pairing-code', code),
      expiresAt,
      attempts: 0,
    };
    return { success: true, value: { code, expiresAt } };
  }

  cancelPairingCode(): void {
    this.pairingCode = null;
  }

  revokeClient(clientId: string): MobileAccessOperationResult {
    const client = this.clients.get(clientId);
    if (!client) {
      return {
        success: false,
        error: { code: 'client_not_found', message: 'The paired device no longer exists.' },
      };
    }
    this.removeClient(client, 4001, 'Access revoked');
    return { success: true };
  }

  revokeAllClients(): void {
    for (const client of [...this.clients.values()]) {
      this.removeClient(client, 4001, 'Access revoked');
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.enqueue(() => this.stopInternal());
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async startInternal(address: string, requestedPort: number): Promise<void> {
    if (this.disposed) return;
    this.setRuntimeState('starting');
    const server = createServer((request, response) => {
      void this.handleHttpRequest(request, response).catch(() => {
        this.logger.warn('Mobile access request failed');
        if (!response.headersSent) this.writeJson(response, 500, { error: 'internal_error' });
        else response.destroy();
      });
    });
    server.headersTimeout = 10_000;
    server.requestTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    server.maxRequestsPerSocket = 100;
    server.on('clientError', (_error, socket) => {
      if (!socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    });
    server.on('upgrade', (request, socket, head) => this.handleUpgrade(request, socket, head));

    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        const onError = (error: Error) => rejectListen(error);
        server.once('error', onError);
        server.listen(requestedPort, address, () => {
          server.off('error', onError);
          const serverAddress = server.address();
          this.activeAddress = address;
          this.activePort =
            serverAddress && typeof serverAddress === 'object' ? serverAddress.port : requestedPort;
          resolveListen();
        });
      });
    } catch (error) {
      server.close();
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('Mobile access failed to bind', { error: message });
      this.setRuntimeState('error', `Could not bind ${address}:${requestedPort}. ${message}`);
      this.startInterfaceMonitor();
      return;
    }

    if (this.disposed) {
      server.close();
      return;
    }

    this.httpServer = server;
    server.on('error', (error) => {
      if (this.httpServer !== server || this.runtimeState !== 'running') return;
      this.logger.warn('Mobile access server error', { error });
      void this.enqueue(async () => {
        await this.stopInternal();
        this.setRuntimeState('error', 'The mobile access server stopped unexpectedly.');
        this.startInterfaceMonitor();
      });
    });
    this.startMaintenanceTimers();
    this.setRuntimeState('running');
    this.logger.info('Mobile access started', { address, port: this.activePort });
  }

  private async stopInternal(): Promise<void> {
    if (!this.httpServer && this.runtimeState === 'disabled') {
      this.clearAuthenticationState();
      return;
    }
    if (this.httpServer) this.setRuntimeState('stopping');
    this.stopMaintenanceTimers();
    this.pairingCode = null;
    this.clearAuthenticationState();

    const server = this.httpServer;
    this.httpServer = null;
    this.activeAddress = null;
    this.activePort = null;
    if (server) {
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
        server.closeAllConnections();
      });
    }
    this.setRuntimeState('disabled');
  }

  private startMaintenanceTimers(): void {
    this.stopMaintenanceTimers();
    this.heartbeatTimer = setInterval(() => {
      for (const connection of [...this.connections]) {
        if (!connection.isAlive) connection.terminate();
        else connection.ping();
      }
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref();

    this.startInterfaceMonitor();
  }

  private startInterfaceMonitor(): void {
    if (this.interfaceTimer) clearInterval(this.interfaceTimer);
    this.interfaceTimer = setInterval(() => {
      if (this.disposed || !this.configuredSettings.enabled) return;
      const address = this.activeAddress ?? this.configuredSettings.bindAddress;
      const available =
        address !== null && isBindableMobileAccessAddress(address, this.getNetworkInterfaces());
      const shouldReconcile =
        (this.runtimeState === 'running' && !available) ||
        (this.runtimeState === 'error' && available);
      if (!shouldReconcile) return;
      void this.reconcile().catch((error: unknown) => {
        this.logger.warn('Mobile access interface reconciliation failed', { error });
      });
    }, this.interfaceCheckIntervalMs);
    this.interfaceTimer.unref();
  }

  private stopMaintenanceTimers(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.interfaceTimer) clearInterval(this.interfaceTimer);
    this.heartbeatTimer = null;
    this.interfaceTimer = null;
  }

  private async handleHttpRequest(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    this.applySecurityHeaders(response);
    if (!this.hasExpectedHost(request)) {
      this.writeJson(response, 421, { error: 'invalid_host' });
      return;
    }
    if (!request.url) {
      this.writeJson(response, 400, { error: 'invalid_request' });
      return;
    }

    const requestUrl = new URL(request.url, this.expectedOrigin());
    if (requestUrl.pathname === '/api/health') {
      if (request.method !== 'GET') this.writeMethodNotAllowed(response, ['GET']);
      else this.writeJson(response, 200, { ok: true, protocolVersion: 1 });
      return;
    }
    if (requestUrl.pathname === '/api/pair') {
      await this.handlePairRequest(request, response);
      return;
    }
    if (requestUrl.pathname === '/api/session') {
      this.handleSessionRequest(request, response);
      return;
    }
    if (requestUrl.pathname === '/api/logout') {
      this.handleLogoutRequest(request, response);
      return;
    }
    if (requestUrl.pathname.startsWith('/api/')) {
      this.writeJson(response, requestUrl.pathname === '/api/ws' ? 426 : 404, {
        error: requestUrl.pathname === '/api/ws' ? 'upgrade_required' : 'not_found',
      });
      return;
    }

    await this.serveStaticAsset(request, response, requestUrl.pathname);
  }

  private async handlePairRequest(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    if (request.method !== 'POST') {
      this.writeMethodNotAllowed(response, ['POST']);
      return;
    }
    if (!this.hasExpectedOrigin(request)) {
      this.writeJson(response, 403, { error: 'invalid_origin' });
      return;
    }
    if (
      !String(request.headers['content-type'] ?? '')
        .toLowerCase()
        .startsWith('application/json')
    ) {
      this.writeJson(response, 415, { error: 'unsupported_media_type' });
      return;
    }
    const rateKey = request.socket.remoteAddress ?? 'unknown';
    if (!this.consumePairRateAttempt(rateKey)) {
      this.writeJson(response, 429, { error: 'rate_limited' });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await this.readBody(request, MAX_PAIRING_BODY_BYTES));
    } catch (error) {
      this.writeJson(response, error instanceof BodyTooLargeError ? 413 : 400, {
        error: error instanceof BodyTooLargeError ? 'body_too_large' : 'invalid_json',
      });
      return;
    }
    if (!parsed || typeof parsed !== 'object') {
      this.writeJson(response, 400, { error: 'invalid_request' });
      return;
    }
    const body = parsed as { code?: unknown; deviceName?: unknown };
    if (typeof body.code !== 'string' || !/^\d{8}$/.test(body.code)) {
      this.writeJson(response, 400, { error: 'invalid_request' });
      return;
    }

    const pairingResult = this.consumePairingCode(body.code);
    if (!pairingResult.success) {
      this.writeJson(response, pairingResult.status, {
        error: pairingResult.error,
        attemptsRemaining: pairingResult.attemptsRemaining,
      });
      return;
    }

    const name = this.sanitizeDeviceName(body.deviceName);
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashSecret('session-token', rawToken).toString('hex');
    const now = this.now();
    const client: ClientRecord = {
      id: randomUUID(),
      name,
      pairedAt: now,
      lastSeenAt: now,
      tokenHash,
      connections: new Set(),
    };
    this.clients.set(client.id, client);
    this.clientsByTokenHash.set(tokenHash, client);
    response.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=${rawToken}; Path=/; HttpOnly; SameSite=Strict`
    );
    this.writeJson(response, 200, { client: this.toClientInfo(client) });
    this.emitClientState();
  }

  private handleSessionRequest(request: IncomingMessage, response: ServerResponse): void {
    if (request.method !== 'GET') {
      this.writeMethodNotAllowed(response, ['GET']);
      return;
    }
    const client = this.authenticate(request);
    if (!client) {
      this.writeJson(response, 401, { authenticated: false });
      return;
    }
    client.lastSeenAt = this.now();
    this.writeJson(response, 200, { authenticated: true, client: this.toClientInfo(client) });
  }

  private handleLogoutRequest(request: IncomingMessage, response: ServerResponse): void {
    if (request.method !== 'POST') {
      this.writeMethodNotAllowed(response, ['POST']);
      return;
    }
    if (!this.hasExpectedOrigin(request)) {
      this.writeJson(response, 403, { error: 'invalid_origin' });
      return;
    }
    const client = this.authenticate(request);
    if (client) this.removeClient(client, 4001, 'Signed out');
    response.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
    );
    response.writeHead(204).end();
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (
      request.method !== 'GET' ||
      !request.url ||
      new URL(request.url, this.expectedOrigin()).pathname !== '/api/ws'
    ) {
      this.rejectUpgrade(socket, 404, 'Not Found');
      return;
    }
    if (!this.hasExpectedHost(request) || !this.hasExpectedOrigin(request)) {
      this.rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }
    const client = this.authenticate(request);
    if (!client) {
      this.rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }
    if (
      this.connections.size >= MAX_CONNECTIONS ||
      client.connections.size >= MAX_CONNECTIONS_PER_CLIENT
    ) {
      this.rejectUpgrade(socket, 429, 'Too Many Requests');
      return;
    }

    this.websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      const connection = new MobileAccessConnectionImpl(
        client.id,
        websocket,
        this.now,
        (closedConnection) => this.handleConnectionClosed(client, closedConnection)
      );
      client.connections.add(connection);
      client.lastSeenAt = this.now();
      this.connections.add(connection);
      websocket.on('message', (data, binary) => {
        client.lastSeenAt = this.now();
        connection.deliver(data, binary);
      });
      websocket.on('pong', () => {
        client.lastSeenAt = this.now();
        connection.markAlive();
      });
      websocket.on('close', () => connection.finishClose());
      websocket.on('error', () => connection.terminate());
      this.emitClientState();

      if (!this.connectionHandler) {
        connection.close(1013, 'Mobile service is not ready');
        return;
      }
      try {
        this.connectionHandler(connection);
      } catch {
        this.logger.error('Mobile access connection handler failed');
        connection.close(1011, 'Connection setup failed');
      }
    });
  }

  private handleConnectionClosed(
    client: ClientRecord,
    connection: MobileAccessConnectionImpl
  ): void {
    client.connections.delete(connection);
    this.connections.delete(connection);
    this.emitClientState();
  }

  private async serveStaticAsset(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string
  ): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      this.writeMethodNotAllowed(response, ['GET', 'HEAD']);
      return;
    }

    const resolvedAsset = await this.resolveStaticAsset(pathname);
    if (!resolvedAsset) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const extension = extname(resolvedAsset.path).toLowerCase();
    const contentType = MIME_TYPES[extension];
    if (!contentType) {
      response.writeHead(415, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Unsupported');
      return;
    }

    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Length', String(resolvedAsset.size));
    response.setHeader(
      'Cache-Control',
      extension !== '.html' && /[-.][A-Za-z0-9_-]{8,}\.[^.]+$/.test(resolvedAsset.path)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache'
    );
    response.writeHead(200);
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(resolvedAsset.path)
      .on('error', () => response.destroy())
      .pipe(response);
  }

  private async resolveStaticAsset(
    pathname: string
  ): Promise<{ path: string; size: number } | null> {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    if (decoded.includes('\0') || decoded.includes('\\')) return null;

    const spaRoot = resolve(this.options.getSpaRoot());
    const segments = decoded.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '.' || segment === '..')) return null;
    const requested = resolve(spaRoot, segments.join('/'));
    const candidate = decoded === '/' ? resolve(spaRoot, 'index.html') : requested;
    let found = await this.safeAsset(candidate, spaRoot);
    if (!found && !extname(decoded))
      found = await this.safeAsset(resolve(spaRoot, 'index.html'), spaRoot);
    return found;
  }

  private async safeAsset(
    candidate: string,
    spaRoot: string
  ): Promise<{ path: string; size: number } | null> {
    if (!this.isContainedPath(spaRoot, candidate)) return null;
    try {
      const [rootRealPath, candidateRealPath, candidateStat] = await Promise.all([
        realpath(spaRoot),
        realpath(candidate),
        stat(candidate),
      ]);
      if (!candidateStat.isFile() || !this.isContainedPath(rootRealPath, candidateRealPath)) {
        return null;
      }
      return { path: candidateRealPath, size: candidateStat.size };
    } catch {
      return null;
    }
  }

  private isContainedPath(root: string, candidate: string): boolean {
    const pathFromRoot = relative(root, candidate);
    return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..');
  }

  private consumePairingCode(
    code: string
  ):
    | { success: true }
    | { success: false; status: number; error: string; attemptsRemaining: number } {
    const pairingCode = this.pairingCode;
    if (!pairingCode || this.now() >= pairingCode.expiresAt) {
      this.pairingCode = null;
      return { success: false, status: 410, error: 'pairing_code_expired', attemptsRemaining: 0 };
    }
    pairingCode.attempts += 1;
    const submittedDigest = this.hashSecret('pairing-code', code);
    if (!timingSafeEqual(submittedDigest, pairingCode.digest)) {
      const attemptsRemaining = Math.max(0, PAIRING_CODE_MAX_ATTEMPTS - pairingCode.attempts);
      if (attemptsRemaining === 0) this.pairingCode = null;
      return {
        success: false,
        status: attemptsRemaining === 0 ? 429 : 401,
        error: attemptsRemaining === 0 ? 'pairing_attempts_exhausted' : 'invalid_pairing_code',
        attemptsRemaining,
      };
    }
    this.pairingCode = null;
    return { success: true };
  }

  private consumePairRateAttempt(address: string): boolean {
    const now = this.now();
    if (this.pairRateByAddress.size > 128) {
      for (const [key, entry] of this.pairRateByAddress) {
        if (now - entry.startedAt >= PAIRING_RATE_WINDOW_MS) this.pairRateByAddress.delete(key);
      }
    }
    let entry = this.pairRateByAddress.get(address);
    if (!entry || now - entry.startedAt >= PAIRING_RATE_WINDOW_MS) {
      entry = { startedAt: now, attempts: 0 };
      this.pairRateByAddress.set(address, entry);
    }
    entry.attempts += 1;
    return entry.attempts <= PAIRING_RATE_MAX_ATTEMPTS;
  }

  private authenticate(request: IncomingMessage): ClientRecord | null {
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader || cookieHeader.length > MAX_COOKIE_BYTES) return null;
    const token = cookieHeader
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return (
      this.clientsByTokenHash.get(this.hashSecret('session-token', token).toString('hex')) ?? null
    );
  }

  private hashSecret(purpose: string, value: string): Buffer {
    return createHmac('sha256', this.authSecret)
      .update(purpose)
      .update('\0')
      .update(value)
      .digest();
  }

  private sanitizeDeviceName(value: unknown): string {
    if (typeof value !== 'string') return 'Mobile device';
    const sanitized = value
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 64);
    return sanitized || 'Mobile device';
  }

  private removeClient(client: ClientRecord, closeCode: number, closeReason: string): void {
    this.clients.delete(client.id);
    this.clientsByTokenHash.delete(client.tokenHash);
    for (const connection of [...client.connections]) {
      connection.close(closeCode, closeReason);
      const forceClose = setTimeout(() => connection.terminate(), 250);
      forceClose.unref();
    }
    this.emitClientState();
  }

  private clearAuthenticationState(): void {
    for (const connection of [...this.connections]) connection.terminate();
    this.connections.clear();
    this.clients.clear();
    this.clientsByTokenHash.clear();
    this.pairRateByAddress.clear();
    this.options.onClientsChanged?.([]);
  }

  private toClientInfo(client: ClientRecord): MobileAccessClient {
    return {
      id: client.id,
      name: client.name,
      pairedAt: client.pairedAt,
      lastSeenAt: client.lastSeenAt,
      connectionCount: client.connections.size,
    };
  }

  private setRuntimeState(state: MobileAccessStatus['state'], error: string | null = null): void {
    this.runtimeState = state;
    this.runtimeError = error;
    this.options.onStatusChanged?.(this.getStatus());
  }

  private emitClientState(): void {
    const clients = this.listClients();
    this.options.onClientsChanged?.(clients);
    this.options.onStatusChanged?.(this.getStatus());
  }

  private expectedAuthority(): string {
    return `${this.activeAddress}:${this.activePort}`;
  }

  private expectedOrigin(): string {
    return `http://${this.expectedAuthority()}`;
  }

  private hasExpectedHost(request: IncomingMessage): boolean {
    return request.headers.host?.toLowerCase() === this.expectedAuthority().toLowerCase();
  }

  private hasExpectedOrigin(request: IncomingMessage): boolean {
    return request.headers.origin?.toLowerCase() === this.expectedOrigin().toLowerCase();
  }

  private applySecurityHeaders(response: ServerResponse): void {
    const origin = this.expectedOrigin();
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; base-uri 'none'; connect-src 'self' ${origin.replace('http:', 'ws:')}; ` +
        "font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; " +
        "media-src 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    );
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader(
      'Permissions-Policy',
      'camera=(), geolocation=(), microphone=(), payment=()'
    );
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
  }

  private writeJson(response: ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload);
    response.setHeader('Cache-Control', 'no-store');
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(body)),
    });
    response.end(body);
  }

  private writeMethodNotAllowed(response: ServerResponse, allowed: string[]): void {
    response.setHeader('Allow', allowed.join(', '));
    this.writeJson(response, 405, { error: 'method_not_allowed' });
  }

  private readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
    return new Promise((resolveBody, rejectBody) => {
      const chunks: Buffer[] = [];
      let byteLength = 0;
      let tooLarge = false;
      request.on('data', (chunk: Buffer) => {
        byteLength += chunk.byteLength;
        if (byteLength > maxBytes) {
          tooLarge = true;
          chunks.length = 0;
        } else if (!tooLarge) {
          chunks.push(chunk);
        }
      });
      request.on('end', () => {
        if (tooLarge) rejectBody(new BodyTooLargeError('Request body is too large'));
        else resolveBody(Buffer.concat(chunks).toString('utf8'));
      });
      request.on('aborted', () => rejectBody(new Error('Request aborted')));
      request.on('error', rejectBody);
    });
  }

  private rejectUpgrade(socket: Duplex, status: number, message: string): void {
    if (socket.destroyed) return;
    socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
}
