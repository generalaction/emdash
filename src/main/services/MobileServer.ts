import http from 'http';
import { randomInt } from 'crypto';
import path from 'path';
import fs from 'fs';
import { networkInterfaces } from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import { log } from '../lib/logger';
import { registerMobileHooks, getActivePtyIds } from './ptyIpc';
import { writePty, getPty } from './ptyManager';
import { parsePtyId } from '../../shared/ptyId';
import { databaseService } from './DatabaseService';
import { terminalSnapshotService } from './TerminalSnapshotService';

const DEFAULT_PORT = 7458;

type MobileFrame =
  | { type: 'auth'; pin: string }
  | { type: 'sessions' }
  | { type: 'subscribe'; ptyId: string }
  | { type: 'input'; ptyId: string; data: string }
  | { type: 'resize'; ptyId: string; cols: number; rows: number };

type SessionInfo = { ptyId: string; label: string; provider: string };

async function resolveSessionLabel(ptyId: string): Promise<SessionInfo> {
  const parsed = parsePtyId(ptyId);
  const provider = parsed?.providerId ?? 'terminal';
  try {
    if (parsed?.kind === 'main') {
      const task = await databaseService.getTaskById(parsed.suffix);
      if (task) {
        const project = await databaseService.getProjectById(task.projectId);
        const label = project ? `${project.name} / ${task.name}` : task.name;
        return { ptyId, label, provider };
      }
    }
  } catch {
    // fall through to raw ID
  }
  const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
  return { ptyId, label: `${providerLabel} session`, provider };
}

export class MobileServer {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private port = DEFAULT_PORT;
  private pin = '';
  // ptyId → set of authenticated, subscribed WebSocket clients
  private subscribers = new Map<string, Set<WebSocket>>();
  // WebSocket → set of ptyIds it is subscribed to (for cleanup on disconnect)
  private clientSubs = new Map<WebSocket, Set<string>>();
  // Authenticated clients
  private authed = new Set<WebSocket>();
  private enabled = false;
  // Rolling output buffer per PTY — replayed to reconnecting clients
  private ptyBuffer = new Map<string, string>();
  private static readonly MAX_BUFFER = 512 * 1024; // 512 KB per PTY
  // PIN brute-force protection
  private failedAttempts = 0;
  private lockedUntil = 0;
  private static readonly MAX_ATTEMPTS = 5;
  private static readonly LOCKOUT_MS = 30_000;

  async start(port = DEFAULT_PORT): Promise<void> {
    if (this.server) return;
    this.port = port;
    this.pin = String(randomInt(100_000, 999_999));
    this.enabled = true;

    const htmlPath = path.join(__dirname, '..', '..', 'mobile', 'index.html');

    this.server = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/index.html') {
        try {
          const html = fs.readFileSync(htmlPath);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
        } catch {
          res.writeHead(404);
          res.end('Mobile UI not found');
        }
        return;
      }
      res.writeHead(404);
      res.end();
    });

    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws, req) => {
      // Allow PIN auth via query param on connect — subject to same lockout as frame auth
      const urlPin = new URL(req.url ?? '/', `http://localhost`).searchParams.get('pin');
      if (urlPin !== null) {
        const now = Date.now();
        if (now < this.lockedUntil) {
          const secs = Math.ceil((this.lockedUntil - now) / 1000);
          this.send(ws, { type: 'error', message: `Too many attempts — try again in ${secs}s` });
          ws.close();
          return;
        }
        if (urlPin === this.pin) {
          this.failedAttempts = 0;
          this.authed.add(ws);
          this.send(ws, { type: 'authed' });
        } else {
          this.failedAttempts += 1;
          if (this.failedAttempts >= MobileServer.MAX_ATTEMPTS) {
            this.lockedUntil = Date.now() + MobileServer.LOCKOUT_MS;
            this.failedAttempts = 0;
          }
          this.send(ws, { type: 'error', message: 'Invalid PIN' });
          ws.close();
          return;
        }
      }

      ws.on('message', (raw) => {
        let frame: MobileFrame;
        try {
          frame = JSON.parse(raw.toString()) as MobileFrame;
        } catch {
          return;
        }
        this.handleFrame(ws, frame);
      });

      ws.on('close', () => {
        this.authed.delete(ws);
        const subs = this.clientSubs.get(ws);
        if (subs) {
          for (const ptyId of subs) {
            const set = this.subscribers.get(ptyId);
            if (set) {
              set.delete(ws);
              if (set.size === 0) this.subscribers.delete(ptyId);
            }
          }
          this.clientSubs.delete(ws);
        }
      });
    });

    registerMobileHooks({
      onData: (id, data) => this.broadcastData(id, data),
      onExit: (id, exitCode, signal) => this.broadcastExit(id, exitCode, signal),
      hasSubscribers: (id) => (this.subscribers.get(id)?.size ?? 0) > 0,
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, '0.0.0.0', () => resolve());
      this.server!.once('error', reject);
    });

    log.info('MobileServer: listening', { port: this.port });
  }

  stop(): void {
    this.enabled = false;
    this.wss?.close();
    this.server?.close();
    this.server = null;
    this.wss = null;
    this.subscribers.clear();
    this.clientSubs.clear();
    this.authed.clear();
    this.ptyBuffer.clear();
  }

  getPort(): number {
    return this.port;
  }

  getPin(): string {
    return this.pin;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getLanUrls(): string[] {
    const ifaces = networkInterfaces();
    const urls: string[] = [];
    for (const list of Object.values(ifaces)) {
      if (!list) continue;
      for (const iface of list) {
        if (iface.family === 'IPv4' && !iface.internal) {
          urls.push(`http://${iface.address}:${this.port}`);
        }
      }
    }
    return urls;
  }

  private handleFrame(ws: WebSocket, frame: MobileFrame): void {
    if (frame.type === 'auth') {
      const now = Date.now();
      if (now < this.lockedUntil) {
        const secs = Math.ceil((this.lockedUntil - now) / 1000);
        this.send(ws, { type: 'error', message: `Too many attempts — try again in ${secs}s` });
        ws.close();
        return;
      }
      if (frame.pin === this.pin) {
        this.failedAttempts = 0;
        this.authed.add(ws);
        this.send(ws, { type: 'authed' });
      } else {
        this.failedAttempts += 1;
        if (this.failedAttempts >= MobileServer.MAX_ATTEMPTS) {
          this.lockedUntil = Date.now() + MobileServer.LOCKOUT_MS;
          this.failedAttempts = 0;
        }
        this.send(ws, { type: 'error', message: 'Invalid PIN' });
        ws.close();
      }
      return;
    }

    if (!this.authed.has(ws)) {
      this.send(ws, { type: 'error', message: 'Not authenticated' });
      return;
    }

    switch (frame.type) {
      case 'sessions': {
        const ids = getActivePtyIds();
        Promise.all(ids.map(resolveSessionLabel)).then((sessions) => {
          this.send(ws, {
            type: 'sessions',
            sessions,
          });
        });
        break;
      }
      case 'subscribe': {
        const { ptyId } = frame;
        if (!getActivePtyIds().includes(ptyId)) {
          this.send(ws, { type: 'error', message: `PTY ${ptyId} not found` });
          return;
        }
        if (!this.subscribers.has(ptyId)) this.subscribers.set(ptyId, new Set());
        this.subscribers.get(ptyId)!.add(ws);
        if (!this.clientSubs.has(ws)) this.clientSubs.set(ws, new Set());
        this.clientSubs.get(ws)!.add(ptyId);
        const buffer = this.ptyBuffer.get(ptyId) ?? null;
        const snapshotPromise = buffer
          ? Promise.resolve(null)
          : terminalSnapshotService.getSnapshot(ptyId);
        Promise.all([resolveSessionLabel(ptyId), snapshotPromise]).then(([info, snapshot]) => {
          const proc = getPty(ptyId);
          this.send(ws, {
            type: 'subscribed',
            ptyId,
            label: info.label,
            snapshot: buffer ?? snapshot?.data ?? null,
            cols: proc?.cols ?? 80,
            rows: proc?.rows ?? 24,
          });
        });
        break;
      }
      case 'input': {
        if (!this.clientSubs.get(ws)?.has(frame.ptyId)) break;
        try {
          writePty(frame.ptyId, frame.data);
        } catch (err) {
          log.warn('MobileServer: writePty error', { ptyId: frame.ptyId, error: String(err) });
        }
        break;
      }
      case 'resize': {
        // Don't forward mobile resize to the PTY — the desktop window owns the dimensions.
        // Applying a phone-sized resize would squish the terminal on the desktop side.
        break;
      }
    }
  }

  private broadcastData(ptyId: string, data: string): void {
    const prev = this.ptyBuffer.get(ptyId) ?? '';
    const combined = prev + data;
    this.ptyBuffer.set(
      ptyId,
      combined.length > MobileServer.MAX_BUFFER
        ? combined.slice(-MobileServer.MAX_BUFFER)
        : combined
    );

    const set = this.subscribers.get(ptyId);
    if (!set) return;
    const frame = JSON.stringify({ type: 'data', ptyId, data });
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) ws.send(frame);
    }
  }

  private broadcastExit(ptyId: string, exitCode: number | null, signal?: number): void {
    this.ptyBuffer.delete(ptyId);
    const set = this.subscribers.get(ptyId);
    if (!set) return;
    const frame = JSON.stringify({ type: 'exit', ptyId, exitCode, signal });
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) ws.send(frame);
    }
    this.subscribers.delete(ptyId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private send(ws: WebSocket, payload: Record<string, any>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }
}

export const mobileServer = new MobileServer();
