/* global fetch, process */

export const EmdashNotifications = async () => ({
  event: async ({ event }) => {
    const payload = toEmdashPayload(event);
    if (!payload) return;

    await sendPayload(payload);
  },
});

async function sendPayload(payload) {
  const port = process.env.EMDASH_HOOK_PORT;
  const token = process.env.EMDASH_HOOK_TOKEN;
  const ptyId = process.env.EMDASH_PTY_ID;
  if (!port || !token || !ptyId) return;

  try {
    await fetch(`http://127.0.0.1:${port}/hook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Emdash-Token': token,
        'X-Emdash-Pty-Id': ptyId,
        'X-Emdash-Event-Type': payload.type,
      },
      body: JSON.stringify(payload.body),
    });
  } catch {
    // Hook delivery is best-effort and must never interrupt OpenCode.
  }
}

function toEmdashPayload(event) {
  const sessionId = readSessionId(event);

  if (event.type === 'session.created') {
    return {
      type: 'notification',
      body: { session_id: sessionId },
    };
  }

  if (event.type === 'session.idle') {
    return {
      type: 'notification',
      body: {
        session_id: sessionId,
        notification_type: 'idle_prompt',
        title: 'OpenCode',
        message: 'OpenCode is ready for input.',
      },
    };
  }

  if (event.type === 'session.error') {
    return {
      type: 'error',
      body: {
        session_id: sessionId,
        title: 'OpenCode error',
        message: typeof event.properties?.error === 'string' ? event.properties.error : undefined,
      },
    };
  }

  return undefined;
}

function readSessionId(event) {
  const properties = event.properties ?? {};
  const value =
    event.sessionID ??
    event.sessionId ??
    event.session_id ??
    event.session?.id ??
    properties.sessionID ??
    properties.sessionId ??
    properties.session_id ??
    properties.session?.id ??
    properties.info?.sessionID ??
    properties.info?.sessionId ??
    properties.info?.session_id;

  return typeof value === 'string' && value.trim() ? value : undefined;
}
