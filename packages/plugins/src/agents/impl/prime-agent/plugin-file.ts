export const PRIME_AGENT_EXTENSION_CONTENT = `\
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

async function notifyEmdash(
  eventType: 'start' | 'stop' | 'error' | 'session',
  body: Record<string, unknown> = {}
) {
  const port = process.env.EMDASH_HOOK_PORT;
  const token = process.env.EMDASH_HOOK_NONCE ?? process.env.EMDASH_HOOK_TOKEN;
  const ptyId = process.env.EMDASH_PTY_ID;

  if (!port || !token || !ptyId) return;

  try {
    await fetch(\`http://127.0.0.1:\${port}/hook\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Emdash-Token': token,
        'X-Emdash-Pty-Id': ptyId,
        'X-Emdash-Event-Type': eventType,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Emdash may not be running when prime-agent is launched directly; ignore hook failures.
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Prime Agent exited with an error';
}

let stopNotified = false;

async function notifyStopOnce(message: string) {
  if (stopNotified) return;
  stopNotified = true;
  await notifyEmdash('stop', { message });
}

export default function (pi: ExtensionAPI) {
  pi.on('session_start', async (_event, ctx) => {
    stopNotified = false;
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (!sessionFile) return;
    await notifyEmdash('session', { providerSessionId: sessionFile });
  });

  pi.on('agent_start', async () => {
    stopNotified = false;
    await notifyEmdash('start');
  });

  pi.on('agent_end', async () => {
    await notifyStopOnce('Task completed');
  });

  pi.on('session_shutdown', async (event) => {
    if (event.reason !== 'quit') return;
    await notifyStopOnce('Session ended');
  });

  process.once('uncaughtException', (error) => {
    void notifyEmdash('error', { message: errorMessage(error) });
  });

  process.once('unhandledRejection', (reason) => {
    void notifyEmdash('error', { message: errorMessage(reason) });
  });
}
`;
