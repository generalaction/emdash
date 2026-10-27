// Verbatim source of the Pi agent extension, embedded as a string constant.
export const PI_EXTENSION_CONTENT = `\
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

async function notifyAgent(
  eventType: 'stop' | 'error' | 'notification' | 'session',
  body: Record<string, unknown> = {}
) {
  const port = process.env.AGENT_HOOK_PORT;
  const token = process.env.AGENT_HOOK_NONCE ?? process.env.AGENT_HOOK_TOKEN;
  const ptyId = process.env.AGENT_PTY_ID;

  if (!port || !token || !ptyId) return;

  try {
    await fetch(\`http://127.0.0.1:\${port}/hook\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Token': token,
        'X-Agent-Pty-Id': ptyId,
        'X-Agent-Event-Type': eventType,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Agent may not be running when pi is launched directly; ignore hook failures.
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Pi exited with an error';
}

export default function (pi: ExtensionAPI) {
  pi.on('session_start', async (_event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (!sessionFile) return;
    await notifyAgent('session', { providerSessionId: sessionFile });
  });

  pi.on('agent_end', async () => {
    await notifyAgent('stop', { message: 'Task completed' });
  });

  pi.on('session_shutdown', async (event) => {
    if (event.reason !== 'quit') return;
    await notifyAgent('stop', { message: 'Session ended' });
  });

  process.once('uncaughtException', (error) => {
    void notifyAgent('error', { message: errorMessage(error) });
  });

  process.once('unhandledRejection', (reason) => {
    void notifyAgent('error', { message: errorMessage(reason) });
  });
}
`;
