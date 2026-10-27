export const OH_MY_PI_EXTENSION_CONTENT = `\
import type { ExtensionAPI } from '@oh-my-pi/pi-coding-agent';

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
    // Agent may not be running when omp is launched directly; ignore hook failures.
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Oh My Pi exited with an error';
}

let stopNotified = false;

async function notifyStopOnce(message: string) {
  if (stopNotified) return;
  stopNotified = true;
  await notifyAgent('stop', { message });
}

export default function (pi: ExtensionAPI) {
  pi.on('session_start', async (_event, ctx) => {
    stopNotified = false;
    const sessionFile = ctx.sessionManager?.getSessionFile?.();
    if (!sessionFile) return;
    await notifyAgent('session', { providerSessionId: sessionFile });
  });

  pi.on('session_stop', async (event) => {
    if (typeof event.session_file === 'string' && event.session_file.trim()) {
      await notifyAgent('session', { providerSessionId: event.session_file });
    }
    await notifyStopOnce('Task completed');
  });

  pi.on('agent_end', async () => {
    await notifyStopOnce('Task completed');
  });

  pi.on('session_shutdown', async () => {
    await notifyStopOnce('Session ended');
  });

  process.once('uncaughtException', (error) => {
    void notifyAgent('error', { message: errorMessage(error) });
  });

  process.once('unhandledRejection', (reason) => {
    void notifyAgent('error', { message: errorMessage(reason) });
  });
}
`;
