import net from 'node:net';
import type { Pty } from '@main/core/pty/pty';
import type {
  DirectPreviewServerHost,
  PreviewServerProtocol,
} from '@shared/core/preview-servers/types';

const PROBE_INTERVAL_MS = 1000;
const PROBE_TIMEOUT_MS = 500;
const PROBE_FAILURES_TO_CLOSE = 2;
const URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d{2,5})?(?:\/\S*)?/g;
const MAX_BUFFER = 4096;

export type DetectedPreviewUrl = {
  protocol: PreviewServerProtocol;
  host: DirectPreviewServerHost;
  port: number;
  urlPath: string;
};

export type PreviewSourceClosed =
  | { reason: 'pty-exit' }
  | { reason: 'local-probe-failed'; server: DetectedPreviewUrl };

export function wireTerminalUrlDetector({
  pty,
  probeLocalPorts = true,
  onDetected,
  onSourceClosed,
}: {
  pty: Pty;
  probeLocalPorts?: boolean;
  onDetected: (server: DetectedPreviewUrl) => void | Promise<void>;
  onSourceClosed?: (event: PreviewSourceClosed) => void | Promise<void>;
}): void {
  let buffer = '';
  const detected = new Map<string, DetectedPreviewUrl>();
  const stopProbes = new Map<string, () => void>();

  const stopAllProbes = () => {
    for (const stop of stopProbes.values()) stop();
    stopProbes.clear();
  };

  pty.onExit(() => {
    buffer = '';
    stopAllProbes();
    void onSourceClosed?.({ reason: 'pty-exit' });
  });

  pty.onData((chunk) => {
    buffer += chunk;
    if (buffer.length > MAX_BUFFER) {
      buffer = buffer.slice(-MAX_BUFFER);
    }

    const clean = stripAnsi(buffer);
    for (const match of clean.matchAll(URL_PATTERN)) {
      const parsed = parsePreviewUrl(match[0]);
      if (!parsed) continue;

      const key = detectedKey(parsed);
      if (detected.has(key)) continue;

      detected.set(key, parsed);
      void onDetected(parsed);

      if (probeLocalPorts) {
        stopProbes.set(
          key,
          startProbe(parsed, () => {
            stopProbes.delete(key);
            detected.delete(key);
            void onSourceClosed?.({ reason: 'local-probe-failed', server: parsed });
          })
        );
      }
    }
  });
}

function stripAnsi(value: string): string {
  return value
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\r/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b\][^\x1b]*\x1b\\/g, '');
}

function parsePreviewUrl(raw: string): DetectedPreviewUrl | null {
  try {
    const url = new URL(raw);
    const protocol = url.protocol === 'https:' ? 'https:' : 'http:';
    const host = normalizeHost(url.hostname);
    const port = Number(url.port) || (protocol === 'https:' ? 443 : 80);
    const urlPath = `${url.pathname || '/'}${url.search}${url.hash}`;
    return { protocol, host, port, urlPath };
  } catch {
    return null;
  }
}

function normalizeHost(host: string): DirectPreviewServerHost {
  return host === 'localhost' ? 'localhost' : '127.0.0.1';
}

function detectedKey(server: DetectedPreviewUrl): string {
  return `${server.protocol}:${server.port}`;
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

function startProbe(server: DetectedPreviewUrl, onClosed: () => void): () => void {
  let stopped = false;
  let consecutiveFailures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    if (stopped) return;
    const open = await isPortOpen(server.host, server.port);
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
    timer = setTimeout(() => {
      void tick();
    }, PROBE_INTERVAL_MS);
  };

  timer = setTimeout(() => {
    void tick();
  }, 0);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
