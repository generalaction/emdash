import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const hookScriptPath = fileURLToPath(new URL('./cursor-emdash-hook.cjs', import.meta.url));

type HookRequest = {
  ptyId: string;
  eventType: string;
  body: Record<string, unknown>;
};

type Session = {
  port?: number;
  token?: string;
  ptyId?: string;
  activePtyId?: string;
  ptySessions?: Record<string, { autoApprove: boolean }>;
  cursorConversations?: Record<string, string>;
};

function runHook({
  cwd,
  event,
  hookInput = {},
}: {
  cwd: string;
  event: string;
  hookInput?: Record<string, unknown>;
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
    child.stdin.end(JSON.stringify(hookInput));
  });
}

async function writeSession(cwd: string, session: Session): Promise<void> {
  await mkdir(join(cwd, '.cursor'), { recursive: true });
  await writeFile(join(cwd, '.cursor/emdash-hook-session.json'), JSON.stringify(session) + '\n');
}

function sessionFor(ptyId: string, options: { autoApprove?: boolean } = {}): Session {
  return {
    port: 1,
    token: 'test-token',
    activePtyId: ptyId,
    ptySessions: { [ptyId]: { autoApprove: options.autoApprove === true } },
    cursorConversations: {},
  };
}

async function withHookServer<T>(
  cwd: string,
  session: Session,
  action: () => Promise<T>
): Promise<{ result: T; requests: HookRequest[] }> {
  const requests: HookRequest[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/hook') {
        requests.push({
          ptyId: String(req.headers['x-emdash-pty-id'] ?? ''),
          eventType: String(req.headers['x-emdash-event-type'] ?? ''),
          body: body ? (JSON.parse(body) as Record<string, unknown>) : {},
        });
      }
      res.writeHead(req.method === 'POST' && req.url === '/hook' ? 200 : 404);
      res.end();
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('hook test server failed to bind');
    await writeSession(cwd, { ...session, port: address.port, token: 'test-token' });
    return { result: await action(), requests };
  } finally {
    server.close();
  }
}

describe('cursor-emdash-hook.cjs', () => {
  const tempDirs: string[] = [];

  async function makeCwd(): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), 'emdash-cursor-hook-'));
    tempDirs.push(cwd);
    return cwd;
  }

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('posts start and completed stop events to the active Emdash pty', async () => {
    const cwd = await makeCwd();
    const { requests } = await withHookServer(
      cwd,
      sessionFor('cursor-conv-emdash-conv-1'),
      async () => {
        await runHook({ cwd, event: 'start', hookInput: { conversation_id: 'conv-123' } });
        await runHook({
          cwd,
          event: 'stop',
          hookInput: { conversation_id: 'conv-123', status: 'completed', loop_count: 0 },
        });
      }
    );

    expect(requests).toEqual([
      { ptyId: 'cursor-conv-emdash-conv-1', eventType: 'start', body: {} },
      {
        ptyId: 'cursor-conv-emdash-conv-1',
        eventType: 'notification',
        body: { notification_type: 'idle_prompt' },
      },
    ]);
  });

  it('does not post idle when the stop hook still has loop budget', async () => {
    const cwd = await makeCwd();
    const { requests } = await withHookServer(cwd, { port: 1, token: 'test-token' }, async () => {
      await runHook({
        cwd,
        event: 'stop',
        hookInput: { conversation_id: 'conv-123', loop_count: 1, loop_limit: 5 },
      });
    });

    expect(requests).toHaveLength(0);
  });

  it('routes known Cursor conversation ids before falling back to active or derived pty ids', async () => {
    const cwd = await makeCwd();
    const session: Session = {
      port: 1,
      token: 'test-token',
      activePtyId: 'cursor-conv-new',
      ptyId: 'cursor-conv-legacy',
      ptySessions: {
        'cursor-conv-old': { autoApprove: false },
        'cursor-conv-new': { autoApprove: false },
      },
      cursorConversations: { 'cursor-native-old': 'cursor-conv-old' },
    };

    const { requests } = await withHookServer(cwd, session, async () => {
      await runHook({
        cwd,
        event: 'stop',
        hookInput: { conversation_id: 'cursor-native-old', loop_count: 5, loop_limit: 5 },
      });
      await runHook({ cwd, event: 'stop', hookInput: { loop_count: 5, loop_limit: 5 } });
    });

    expect(requests.map((request) => request.ptyId)).toEqual([
      'cursor-conv-old',
      'cursor-conv-new',
    ]);
  });

  it('derives and remembers a pty id when session pty ids are missing', async () => {
    const cwd = await makeCwd();

    const { requests } = await withHookServer(cwd, { port: 1, token: 'test-token' }, async () => {
      await runHook({
        cwd,
        event: 'stop',
        hookInput: { conversation_id: 'cursor-native-99', loop_count: 5, loop_limit: 5 },
      });
    });

    expect(requests[0]?.ptyId).toBe('cursor-conv-cursor-native-99');
    const session = JSON.parse(
      await readFile(join(cwd, '.cursor/emdash-hook-session.json'), 'utf8')
    ) as Session;
    expect(session.cursorConversations).toEqual({
      'cursor-native-99': 'cursor-conv-cursor-native-99',
    });
  });

  it.each([
    { autoApprove: true, expectedStdout: { permission: 'allow' } },
    { autoApprove: false, expectedStdout: undefined },
  ])('handles permission hooks when autoApprove=$autoApprove', async (testCase) => {
    const cwd = await makeCwd();
    const { result, requests } = await withHookServer(
      cwd,
      sessionFor('cursor-conv-emdash-conv-1', { autoApprove: testCase.autoApprove }),
      () => runHook({ cwd, event: 'permission', hookInput: { conversation_id: 'conv-456' } })
    );

    expect(result.stdout.trim() ? JSON.parse(result.stdout.trim()) : undefined).toEqual(
      testCase.expectedStdout
    );
    expect(requests).toHaveLength(0);
  });
});
