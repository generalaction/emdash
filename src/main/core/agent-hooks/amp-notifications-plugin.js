// @i-know-the-amp-plugin-api-is-wip-and-very-experimental-right-now
/* global fetch, process */

export default function EmdashAmpNotifications(amp) {
  const port = process.env.EMDASH_HOOK_PORT;
  const token = process.env.EMDASH_HOOK_TOKEN;
  const ptyId = process.env.EMDASH_PTY_ID;
  if (!port || !token || !ptyId) return;

  const post = async (eventType, body) => {
    try {
      await fetch(`http://127.0.0.1:${port}/hook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Emdash-Token': token,
          'X-Emdash-Pty-Id': ptyId,
          'X-Emdash-Event-Type': eventType,
        },
        body: JSON.stringify(body ?? {}),
      });
    } catch {
      // Hook delivery is best-effort and must never interrupt Amp.
    }
  };

  amp.on('agent.start', async (event) => {
    await post('working', {
      message: typeof event.message === 'string' ? event.message : undefined,
    });
    return {};
  });

  amp.on('agent.end', async (event) => {
    await post(event.status === 'error' ? 'error' : 'stop', {
      message: typeof event.message === 'string' ? event.message : undefined,
    });
  });
}
