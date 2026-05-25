import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const hookScriptPath = fileURLToPath(new URL('./cursor-emdash-hook.cjs', import.meta.url));

function runHook({
  cwd,
  event,
  hookInput,
}: {
  cwd: string;
  event: string;
  hookInput: string;
}): Promise<{ stdout: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookScriptPath, event], {
      cwd,
      env: { ...process.env, CURSOR_PROJECT_DIR: cwd },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ stdout, exitCode }));
    child.stdin.write(hookInput);
    child.stdin.end();
  });
}

describe('cursor-emdash-hook.cjs', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('posts start event for beforeSubmitPrompt', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'emdash-cursor-hook-'));
    tempDirs.push(cwd);

    const received = await new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        if (req.method !== 'POST' || req.url !== '/hook') {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200);
        res.end();
        resolve(String(req.headers['x-emdash-event-type'] ?? ''));
      });
      server.listen(0, '127.0.0.1', async () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('hook test server failed to bind'));
          return;
        }
        try {
          await mkdir(join(cwd, '.cursor'), { recursive: true });
          await writeFile(
            join(cwd, '.cursor/emdash-hook-session.json'),
            JSON.stringify({
              port: address.port,
              token: 'test-token',
              ptyId: 'cursor-conv-emdash-conv-1',
            }) + '\n'
          );
          await runHook({
            cwd,
            event: 'start',
            hookInput: JSON.stringify({ conversation_id: 'conv-123' }),
          });
        } finally {
          server.close();
        }
      });
    });

    expect(received).toBe('start');
  });

  it('posts idle_prompt for stop using conversation_id from hook stdin', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'emdash-cursor-hook-'));
    tempDirs.push(cwd);

    const received = await new Promise<{
      ptyId: string;
      eventType: string;
      body: Record<string, unknown>;
    }>((resolve, reject) => {
      const server = createServer((req, res) => {
        if (req.method !== 'POST' || req.url !== '/hook') {
          res.writeHead(404);
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          resolve({
            ptyId: String(req.headers['x-emdash-pty-id'] ?? ''),
            eventType: String(req.headers['x-emdash-event-type'] ?? ''),
            body: JSON.parse(body) as Record<string, unknown>,
          });
          res.writeHead(200);
          res.end();
        });
      });
      server.listen(0, '127.0.0.1', async () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('hook test server failed to bind'));
          return;
        }
        try {
          await mkdir(join(cwd, '.cursor'), { recursive: true });
          await writeFile(
            join(cwd, '.cursor/emdash-hook-session.json'),
            JSON.stringify({
              port: address.port,
              token: 'test-token',
              ptyId: 'cursor-conv-emdash-conv-1',
            }) + '\n'
          );
          const result = await runHook({
            cwd,
            event: 'stop',
            hookInput: JSON.stringify({
              conversation_id: 'conv-123',
              status: 'completed',
              loop_count: 0,
            }),
          });
          expect(result.exitCode).toBe(0);
        } finally {
          server.close();
        }
      });
    });

    expect(received.ptyId).toBe('cursor-conv-emdash-conv-1');
    expect(received.eventType).toBe('notification');
    expect(received.body).toEqual({ notification_type: 'idle_prompt' });
  });

  it('does not post idle when stop hook has remaining loop budget', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'emdash-cursor-hook-'));
    tempDirs.push(cwd);

    let requestCount = 0;
    const server = createServer((req, res) => {
      requestCount++;
      res.writeHead(200);
      res.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', async () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('hook test server failed to bind'));
          return;
        }
        try {
          await mkdir(join(cwd, '.cursor'), { recursive: true });
          await writeFile(
            join(cwd, '.cursor/emdash-hook-session.json'),
            JSON.stringify({ port: address.port, token: 'test-token' }) + '\n'
          );
          await runHook({
            cwd,
            event: 'stop',
            hookInput: JSON.stringify({
              conversation_id: 'conv-123',
              loop_count: 1,
              loop_limit: 5,
            }),
          });
        } finally {
          server.close();
          resolve();
        }
      });
    });

    expect(requestCount).toBe(0);
  });

  it('falls back to cursor conversation_id when session ptyId is missing', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'emdash-cursor-hook-'));
    tempDirs.push(cwd);

    const received = await new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        if (req.method !== 'POST' || req.url !== '/hook') {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200);
        res.end();
        resolve(String(req.headers['x-emdash-pty-id'] ?? ''));
      });
      server.listen(0, '127.0.0.1', async () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('hook test server failed to bind'));
          return;
        }
        try {
          await mkdir(join(cwd, '.cursor'), { recursive: true });
          await writeFile(
            join(cwd, '.cursor/emdash-hook-session.json'),
            JSON.stringify({ port: address.port, token: 'test-token' }) + '\n'
          );
          await runHook({
            cwd,
            event: 'stop',
            hookInput: JSON.stringify({
              conversation_id: 'cursor-native-99',
              loop_count: 5,
              loop_limit: 5,
            }),
          });
        } finally {
          server.close();
        }
      });
    });

    expect(received).toBe('cursor-conv-cursor-native-99');
  });

  it('posts idle_prompt using session ptyId when hook stdin has no conversation_id', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'emdash-cursor-hook-'));
    tempDirs.push(cwd);

    const received = await new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        if (req.method !== 'POST' || req.url !== '/hook') {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200);
        res.end();
        resolve(String(req.headers['x-emdash-pty-id'] ?? ''));
      });
      server.listen(0, '127.0.0.1', async () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('hook test server failed to bind'));
          return;
        }
        try {
          await mkdir(join(cwd, '.cursor'), { recursive: true });
          await writeFile(
            join(cwd, '.cursor/emdash-hook-session.json'),
            JSON.stringify({
              port: address.port,
              token: 'test-token',
              ptyId: 'cursor-conv-emdash-only',
            }) + '\n'
          );
          await runHook({
            cwd,
            event: 'stop',
            hookInput: JSON.stringify({ loop_count: 5, loop_limit: 5 }),
          });
        } finally {
          server.close();
        }
      });
    });

    expect(received).toBe('cursor-conv-emdash-only');
  });

  it('prints allow JSON for permission hooks without posting to Emdash', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'emdash-cursor-hook-'));
    tempDirs.push(cwd);

    let requestCount = 0;
    const server = createServer((req, res) => {
      requestCount++;
      res.writeHead(200);
      res.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', async () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('hook test server failed to bind'));
          return;
        }
        try {
          await mkdir(join(cwd, '.cursor'), { recursive: true });
          await writeFile(
            join(cwd, '.cursor/emdash-hook-session.json'),
            JSON.stringify({ port: address.port, token: 'test-token' }) + '\n'
          );
          const result = await runHook({
            cwd,
            event: 'permission',
            hookInput: JSON.stringify({ conversation_id: 'conv-456' }),
          });
          expect(JSON.parse(result.stdout.trim())).toEqual({ permission: 'allow' });
        } finally {
          server.close();
          resolve();
        }
      });
    });

    expect(requestCount).toBe(0);
  });
});
