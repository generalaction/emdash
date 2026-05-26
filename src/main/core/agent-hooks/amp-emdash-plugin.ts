// @i-know-the-amp-plugin-api-is-wip-and-very-experimental-right-now

type AmpPluginAPI = {
  on(event: 'agent.start', handler: () => unknown): void;
  on(event: 'agent.end', handler: () => unknown): void;
};

async function notifyEmdash(
  eventType: 'start' | 'stop' | 'error',
  body: Record<string, unknown> = {}
) {
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
        'X-Emdash-Event-Type': eventType,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Emdash may not be running when Amp is launched directly; ignore hook failures.
  }
}

export default function (amp: AmpPluginAPI) {
  amp.on('agent.start', async () => {
    await notifyEmdash('start');
  });

  amp.on('agent.end', async () => {
    await notifyEmdash('stop', { message: 'Task completed' });
  });
}
