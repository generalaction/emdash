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

function writeSession(session) {
  try {
    fs.writeFileSync(sessionFile, JSON.stringify(session) + '\n');
  } catch {
    // Hook delivery must not fail the Cursor command.
  }
}

function parseHookPayload(hookInput) {
  try {
    return JSON.parse(hookInput);
  } catch {
    return {};
  }
}

function parseConversationId(payload) {
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

function getActivePtyId(session) {
  if (typeof session?.activePtyId === 'string' && session.activePtyId.length > 0) {
    return session.activePtyId;
  }
  if (typeof session?.ptyId === 'string' && session.ptyId.length > 0) {
    return session.ptyId;
  }
  return undefined;
}

function getPtySession(session, ptyId) {
  const ptySessions = session?.ptySessions;
  if (ptySessions && typeof ptySessions === 'object') {
    const ptySession = ptySessions[ptyId];
    if (ptySession && typeof ptySession === 'object') return ptySession;
  }

  return { autoApprove: session?.autoApprove === true };
}

function resolvePtyId(session, conversationId) {
  const cursorConversations = session?.cursorConversations;
  if (conversationId && cursorConversations && typeof cursorConversations === 'object') {
    const mappedPtyId = cursorConversations[conversationId];
    if (typeof mappedPtyId === 'string' && mappedPtyId.length > 0) return mappedPtyId;
  }

  const activePtyId = getActivePtyId(session);
  if (activePtyId) return activePtyId;
  return conversationId ? makePtyId(conversationId) : undefined;
}

function bindCursorConversation(session, conversationId, ptyId) {
  if (!conversationId || !ptyId || session.cursorConversations?.[conversationId] === ptyId) return;
  session.cursorConversations = {
    ...(session.cursorConversations && typeof session.cursorConversations === 'object'
      ? session.cursorConversations
      : {}),
    [conversationId]: ptyId,
  };
  writeSession(session);
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
  const hookInput = await readStdin();
  const session = readSession();
  if (!session?.port || !session?.token) return;

  const payload = parseHookPayload(hookInput);
  const conversationId = parseConversationId(payload);
  const ptyId = resolvePtyId(session, conversationId);

  if (!ptyId) return;
  bindCursorConversation(session, conversationId, ptyId);

  if (event === 'permission') {
    if (getPtySession(session, ptyId).autoApprove === true) {
      process.stdout.write(JSON.stringify({ permission: 'allow' }) + '\n');
    }
    return;
  }

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
