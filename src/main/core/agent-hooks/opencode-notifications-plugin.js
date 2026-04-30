const EMDASH_MARKER = 'EMDASH_HOOK_PORT';

export const EmdashNotifications = async () => ({
  event: async ({ event }) => {
    const port = process.env.EMDASH_HOOK_PORT;
    const token = process.env.EMDASH_HOOK_TOKEN;
    const ptyId = process.env.EMDASH_PTY_ID;
    if (!port || !token || !ptyId) return;

    const payload = toEmdashPayload(event);
    if (!payload) return;

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
  },
});

function toEmdashPayload(event) {
  if (event.type === 'session.idle') {
    return {
      type: 'notification',
      body: {
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
        title: 'OpenCode error',
        message: typeof event.properties?.error === 'string' ? event.properties.error : undefined,
      },
    };
  }

  return undefined;
}
