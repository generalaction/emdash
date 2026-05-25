#!/usr/bin/env node
/**
 * Cursor CLI hook script for Emdash.
 * Usage: node emdash-notify.cjs <stop|start|permission>
 * Hook JSON payload is read from stdin (injected by cursor-agent).
 */
const fs = require('node:fs');
const http = require('node:http');

const event = process.argv[2];
const projectDir = process.env.CURSOR_PROJECT_DIR || process.cwd();
const sessionFile = `${projectDir}/.cursor/emdash-hook-session.json`;
const PTY_CONVERSATION_SEP = '-conv-';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
  });
}

function readSession() {
  try {
    return JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  } catch {
    return null;
  }
}

function parseHookPayload(hookInput) {
  try {
    return JSON.parse(hookInput);
  } catch {
    return {};
  }
}

function parseConversationId(hookInput) {
  const payload = parseHookPayload(hookInput);
  const id = payload.conversation_id ?? payload.conversationId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

function shouldReportIdle(payload) {
  const status = payload.status;
  if (typeof status === 'string' && /aborted|cancel/i.test(status)) {
    return false;
  }

  const loopCount = typeof payload.loop_count === 'number' ? payload.loop_count : undefined;
  const loopLimit = typeof payload.loop_limit === 'number' ? payload.loop_limit : undefined;
  if (loopCount !== undefined && loopLimit !== undefined && loopCount < loopLimit) {
    return false;
  }

  return true;
}

function makePtyId(conversationId) {
  return `cursor${PTY_CONVERSATION_SEP}${conversationId}`;
}

function postHook({ port, token, ptyId, eventType, body }) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/hook',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'X-Emdash-Token': token,
          'X-Emdash-Pty-Id': ptyId,
          'X-Emdash-Event-Type': eventType,
        },
      },
      (res) => {
        res.resume();
        resolve();
      }
    );
    req.on('error', () => resolve());
    req.setTimeout(2000, () => {
      req.destroy();
      resolve();
    });
    req.write(payload);
    req.end();
  });
}

async function main() {
  if (event === 'permission') {
    process.stdout.write(JSON.stringify({ permission: 'allow' }) + '\n');
  }

  const hookInput = await readStdin();
  const session = readSession();
  if (!session?.port || !session?.token) return;

  const conversationId = parseConversationId(hookInput);
  // Cursor chat IDs differ from Emdash conversation IDs — always prefer the PTY id
  // written when the session started. Fall back to the hook payload only when needed.
  const ptyId =
    typeof session.ptyId === 'string' && session.ptyId.length > 0
      ? session.ptyId
      : conversationId
        ? makePtyId(conversationId)
        : undefined;

  if (!ptyId) return;

  if (event === 'start') {
    await postHook({
      port: session.port,
      token: session.token,
      ptyId,
      eventType: 'start',
      body: {},
    });
    return;
  }

  if (event === 'stop') {
    const payload = parseHookPayload(hookInput);
    if (!shouldReportIdle(payload)) return;

    await postHook({
      port: session.port,
      token: session.token,
      ptyId,
      eventType: 'notification',
      body: { notification_type: 'idle_prompt' },
    });
    return;
  }

  // Permission hooks only auto-allow via stdout — do not POST permission_prompt here.
  // That notification plays the needs_attention sound on every shell/MCP call.
}

main().catch(() => {
  process.exit(0);
});
