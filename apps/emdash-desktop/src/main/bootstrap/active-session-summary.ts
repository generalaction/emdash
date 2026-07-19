import type { ActiveSessionSummary } from '@core/features/workbench/api';
import {
  getAcpRuntimeClient,
  getTerminalsRuntimeClient,
  getTuiAgentsRuntimeClient,
} from '@main/gateway/accessors';
import { log } from '@main/lib/logger';

const SESSION_READ_DEADLINE_MS = 500;

export async function getActiveSessionSummary(): Promise<ActiveSessionSummary> {
  const [acpSessions, tuiSessions, terminals] = await Promise.all([
    readWithDeadline(
      'acp',
      async () => {
        const client = await getAcpRuntimeClient();
        const snapshot = await client.sessions.state(undefined, 'list').snapshot();
        return Object.values(snapshot.data).filter(
          (session) => session.lifecycle === 'working' || session.isGenerating
        ).length;
      },
      0
    ),
    readWithDeadline(
      'tui-agents',
      async () => {
        const client = await getTuiAgentsRuntimeClient();
        const snapshot = await client.sessions.state(undefined, 'list').snapshot();
        const running = Object.values(snapshot.data).filter(
          (session) => session.status === 'running'
        );
        return {
          local: running.filter((session) => !session.isRemote).length,
          remote: running.filter((session) => session.isRemote).length,
        };
      },
      { local: 0, remote: 0 }
    ),
    readWithDeadline(
      'terminals',
      async () => {
        const client = await getTerminalsRuntimeClient();
        const snapshot = await client.sessions.state(undefined, 'list').snapshot();
        return Object.values(snapshot.data).filter(
          (session) => session.status === 'running' && session.kind === 'terminal'
        ).length;
      },
      0
    ),
  ]);

  return {
    acpSessions: acpSessions.value,
    localTuiSessions: tuiSessions.value.local,
    remoteTuiSessions: tuiSessions.value.remote,
    terminals: terminals.value,
    incomplete: acpSessions.incomplete || tuiSessions.incomplete || terminals.incomplete,
  };
}

interface DeadlineRead<T> {
  value: T;
  incomplete: boolean;
}

async function readWithDeadline<T>(
  name: string,
  read: () => Promise<T>,
  fallback: T
): Promise<DeadlineRead<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pending = read().then((value) => ({ value, incomplete: false }));
    void pending.catch(() => undefined);
    return await Promise.race([
      pending,
      new Promise<DeadlineRead<T>>((resolve) => {
        timer = setTimeout(
          () => resolve({ value: fallback, incomplete: true }),
          SESSION_READ_DEADLINE_MS
        );
      }),
    ]);
  } catch (error) {
    log.warn(`quit: failed to read ${name} sessions`, { error: String(error) });
    return { value: fallback, incomplete: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
