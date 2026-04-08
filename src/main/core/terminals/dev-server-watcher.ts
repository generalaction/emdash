import net from 'node:net';
import { hostPreviewEventChannel } from '@shared/events/hostPreviewEvents';
import { stripAnsi } from '@main/core/agent-hooks/classifiers/base';
import { events } from '@main/lib/events';
import type { Pty } from '../pty/pty';

const PROBE_INTERVAL_MS = 1000;
const PROBE_TIMEOUT_MS = 500;
const PROBE_FAILURES_TO_CLOSE = 2;

const URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d{2,5})?(?:\/\S*)?/;
const MAX_BUFFER = 4096;

function normalizeUrl(raw: string): string {
  return raw.replace('0.0.0.0', '127.0.0.1');
}

function parseTarget(url: string): { host: string; port: number } | null {
  try {
    const u = new URL(url);
    const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
    const host = u.hostname === '0.0.0.0' ? '127.0.0.1' : u.hostname;
    return { host, port };
  } catch {
    return null;
  }
}

function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function startProbe(url: string, onClosed: () => void): () => void {
  const target = parseTarget(url);
  if (!target) return () => {};

  let stopped = false;
  let consecutiveFailures = 0;
  let timer: ReturnType<typeof setTimeout>;

  const tick = async () => {
    if (stopped) return;
    const open = await isPortOpen(target.host, target.port);
    if (stopped) return;
    if (open) {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures++;
      if (consecutiveFailures >= PROBE_FAILURES_TO_CLOSE) {
        stopped = true;
        onClosed();
        return;
      }
    }
    timer = setTimeout(tick, PROBE_INTERVAL_MS);
  };

  timer = setTimeout(tick, 0);

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

export function wireTerminalDevServerWatcher({
  pty,
  scopeId,
  terminalId,
  probe = true,
}: {
  pty: Pty;
  scopeId: string;
  terminalId: string;
  /** Set to false for SSH sessions where remote ports are not locally reachable */
  probe?: boolean;
}): void {
  let buffer = '';
  let found = false;
  let stopProbe: (() => void) | null = null;

  const cleanup = () => {
    buffer = '';
    stopProbe?.();
    stopProbe = null;
    if (found) {
      found = false;
      events.emit(hostPreviewEventChannel, { type: 'exit', taskId: scopeId, terminalId });
    }
  };

  pty.onExit(cleanup);

  pty.onData((chunk) => {
    if (found) return;

    buffer += chunk;
    if (buffer.length > MAX_BUFFER) {
      buffer = buffer.slice(-MAX_BUFFER);
    }

    const clean = stripAnsi(buffer);
    const match = clean.match(URL_PATTERN);
    if (!match) return;

    found = true;
    const url = normalizeUrl(match[0]);
    events.emit(hostPreviewEventChannel, { type: 'url', taskId: scopeId, terminalId, url });

    if (probe) {
      stopProbe = startProbe(url, cleanup);
    }
  });
}
