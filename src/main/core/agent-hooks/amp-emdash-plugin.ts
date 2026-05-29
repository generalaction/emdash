// @i-know-the-amp-plugin-api-is-wip-and-very-experimental-right-now

type AmpPluginAPI = {
  on(
    event: 'agent.start',
    handler: (event: AmpAgentEvent, ctx?: AmpPluginContext) => unknown
  ): void;
  on(event: 'agent.end', handler: (event: unknown, ctx?: AmpPluginContext) => unknown): void;
};

type AmpAgentEvent = {
  thread?: {
    id?: string;
  };
};

type AmpPluginContext = {
  thread?: {
    id?: string;
  };
};

async function notifyEmdash(eventType: 'start' | 'stop', body: Record<string, unknown> = {}) {
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

function getThreadId(event: AmpAgentEvent, ctx?: AmpPluginContext): string | undefined {
  const threadId = event.thread?.id ?? ctx?.thread?.id;
  return typeof threadId === 'string' && threadId.trim() ? threadId.trim() : undefined;
}

export default function (amp: AmpPluginAPI) {
  amp.on('agent.start', async (event, ctx) => {
    await notifyEmdash('start', { providerSessionId: getThreadId(event, ctx) });
  });

  amp.on('agent.end', async () => {
    await notifyEmdash('stop', { message: 'Task completed' });
  });
}
