import { describe, expect, it, vi } from 'vitest';
import type { Pty, PtyExitInfo } from '@main/core/pty/pty';
import {
  wireTerminalUrlDetector,
  type DetectedPreviewUrl,
  type PreviewSourceClosed,
} from './terminal-url-detector';

function fakePty(): Pty & {
  emitData(data: string): void;
  emitExit(info?: PtyExitInfo): void;
} {
  const dataHandlers: Array<(data: string) => void> = [];
  const exitHandlers: Array<(info: PtyExitInfo) => void> = [];

  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (handler) => dataHandlers.push(handler),
    onExit: (handler) => exitHandlers.push(handler),
    emitData(data) {
      for (const handler of dataHandlers) handler(data);
    },
    emitExit(info = { exitCode: 0 }) {
      for (const handler of exitHandlers) handler(info);
    },
  };
}

describe('wireTerminalUrlDetector', () => {
  it('reports each localhost URL once with normalized host and path details', () => {
    const pty = fakePty();
    const detected: DetectedPreviewUrl[] = [];
    const closed: PreviewSourceClosed[] = [];

    wireTerminalUrlDetector({
      pty,
      probeLocalPorts: false,
      onDetected: (server) => {
        detected.push(server);
      },
      onSourceClosed: (event) => {
        closed.push(event);
      },
    });

    pty.emitData(
      '\x1b[32mready\x1b[0m http://localhost:3000/app?tab=1#top and http://0.0.0.0:5173/'
    );
    pty.emitData('duplicate http://localhost:3000/ignored');
    pty.emitData('later https://127.0.0.1:8443/admin');
    pty.emitExit();

    expect(detected).toEqual([
      {
        protocol: 'http:',
        host: 'localhost',
        port: 3000,
        urlPath: '/app?tab=1#top',
      },
      {
        protocol: 'http:',
        host: '127.0.0.1',
        port: 5173,
        urlPath: '/',
      },
      {
        protocol: 'https:',
        host: '127.0.0.1',
        port: 8443,
        urlPath: '/admin',
      },
    ]);
    expect(closed).toEqual([{ reason: 'pty-exit' }]);
  });

  it('trims unmatched trailing parentheses from detected preview URLs', () => {
    const pty = fakePty();
    const detected: DetectedPreviewUrl[] = [];

    wireTerminalUrlDetector({
      pty,
      probeLocalPorts: false,
      onDetected: (server) => {
        detected.push(server);
      },
    });

    pty.emitData('Local: (http://localhost:3000/)');
    pty.emitData('Balanced path: http://localhost:3001/foo(bar)');
    pty.emitData('Extra closing path: http://localhost:3002/foo(bar))');

    expect(detected).toEqual([
      {
        protocol: 'http:',
        host: 'localhost',
        port: 3000,
        urlPath: '/',
      },
      {
        protocol: 'http:',
        host: 'localhost',
        port: 3001,
        urlPath: '/foo(bar)',
      },
      {
        protocol: 'http:',
        host: 'localhost',
        port: 3002,
        urlPath: '/foo(bar)',
      },
    ]);
  });
});
