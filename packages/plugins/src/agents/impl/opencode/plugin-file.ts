// Verbatim source of the OpenCode emdash notifications plugin, embedded as a string constant.
export const OPENCODE_PLUGIN_CONTENT = `\
/* global fetch, process */

// Keep terminal outcomes until the next start: OpenCode can emit both idle
// events after an error, interruption, or successful execution.
const settledSessions = new Set();

export const EmdashNotifications = async () => ({ event: handleOpenCodeEvent });

export default {
  id: 'emdash-notifications',
  setup: ({ event }) => {
    const controller = new AbortController();

    void consumeEvents(event, controller.signal);

    return () => controller.abort();
  },
};

async function consumeEvents(eventApi, signal) {
  try {
    for await (const event of eventApi.subscribe({ signal })) {
      await handleOpenCodeEvent({ event });
    }
  } catch {
    // Hook delivery is best-effort and must never interrupt OpenCode.
  }
}

async function handleOpenCodeEvent({ event }) {
  const port = process.env.EMDASH_HOOK_PORT;
  const token = process.env.EMDASH_HOOK_NONCE ?? process.env.EMDASH_HOOK_TOKEN;
  const ptyId = process.env.EMDASH_PTY_ID;
  if (!port || !token || !ptyId) return;

  const sessionId = getOpenCodeSessionId(event);
  const payload = toEmdashPayload(event, sessionId ?? ptyId);
  if (sessionId) {
    await postToEmdash({ port, token, ptyId, type: 'session', body: { sessionId } });
  }

  if (!payload) return;

  await postToEmdash({ port, token, ptyId, type: payload.type, body: payload.body });
}

async function postToEmdash({ port, token, ptyId, type, body }) {
  try {
    await fetch(\`http://127.0.0.1:\${port}/hook\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Emdash-Token': token,
        'X-Emdash-Pty-Id': ptyId,
        'X-Emdash-Event-Type': type,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Hook delivery is best-effort and must never interrupt OpenCode.
  }
}

function getOpenCodeSessionId(event) {
  if (!event.type?.startsWith('session.')) return undefined;

  const infoId = event.properties?.info?.id;
  if (isOpenCodeSessionId(infoId)) return infoId.trim();

  const sessionId = event.properties?.sessionID;
  if (isOpenCodeSessionId(sessionId)) return sessionId.trim();

  const dataSessionId = event.data?.sessionID;
  if (isOpenCodeSessionId(dataSessionId)) return dataSessionId.trim();

  return undefined;
}

function isOpenCodeSessionId(value) {
  return typeof value === 'string' && value.trim().startsWith('ses');
}

function sessionStatusType(event) {
  const status = event.properties?.status ?? event.data?.status;
  return typeof status?.type === 'string' ? status.type : undefined;
}

function toEmdashPayload(event, sessionId) {
  if (event.type === 'session.deleted') {
    settledSessions.delete(sessionId);
    return undefined;
  }

  // Prefer session.status — reliable for custom OpenAI-compatible providers
  // (Unbar/MiniMax/etc.) where session.execution.* may never fire.
  const status = event.type === 'session.status' ? sessionStatusType(event) : undefined;
  if (status === 'busy' || status === 'retry' || event.type === 'session.execution.started') {
    settledSessions.delete(sessionId);
    return { type: 'start', body: { title: 'OpenCode' } };
  }

  if (event.type === 'session.error' || event.type === 'session.execution.failed') {
    settledSessions.add(sessionId);
    return {
      type: 'error',
      body: {
        title: 'OpenCode error',
        message: getErrorMessage(event.properties?.error ?? event.data?.error),
      },
    };
  }

  if (
    status === 'idle' ||
    event.type === 'session.idle' ||
    event.type === 'session.execution.succeeded' ||
    event.type === 'session.execution.interrupted'
  ) {
    if (settledSessions.has(sessionId)) return undefined;
    settledSessions.add(sessionId);
    if (event.type === 'session.execution.interrupted') {
      return {
        type: 'notification',
        body: { title: 'OpenCode', message: 'OpenCode execution was interrupted.' },
      };
    }
    return { type: 'stop', body: { title: 'OpenCode' } };
  }

  return undefined;
}

function getErrorMessage(error) {
  if (typeof error === 'string') return error;
  if (typeof error?.message === 'string') return error.message;
  return undefined;
}
`;
