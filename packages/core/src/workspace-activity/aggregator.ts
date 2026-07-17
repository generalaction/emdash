import type { Unsubscribe } from '@emdash/shared';
import {
  createLiveModelHost,
  createLiveModelReplica,
  type ContractClient,
  type LiveModelHost,
} from '@emdash/wire';
import { activityProviderContract, workspaceActivityContract } from './contract';
import type { SessionInfo } from './schema';

export type ActivityProvider = {
  runtime: string;
  attach(onSessions: (sessions: SessionInfo[]) => void): Unsubscribe;
};

export type ActivityProviderClient = Pick<
  ContractClient<typeof activityProviderContract>,
  'activity'
>;

export class ActivityAggregator {
  readonly host: LiveModelHost<typeof workspaceActivityContract.workspaceActivity>;

  private readonly providerSessions = new Map<string, SessionInfo[]>();
  private readonly providerDetach = new Map<string, Unsubscribe>();

  constructor(providers: ActivityProvider[] = []) {
    this.host = createLiveModelHost(workspaceActivityContract.workspaceActivity);
    for (const provider of providers) this.addProvider(provider);
  }

  addProvider(provider: ActivityProvider): Unsubscribe {
    this.removeProvider(provider.runtime);
    const detach = provider.attach((sessions) => {
      this.providerSessions.set(provider.runtime, normalizeSessions(provider.runtime, sessions));
      this.publish();
    });
    const unsubscribe = () => {
      detach();
      this.providerDetach.delete(provider.runtime);
      this.providerSessions.delete(provider.runtime);
      this.publish();
    };
    this.providerDetach.set(provider.runtime, unsubscribe);
    return unsubscribe;
  }

  removeProvider(runtime: string): void {
    this.providerDetach.get(runtime)?.();
  }

  sessionsFor(path: string): SessionInfo[] {
    return sortedSessions(this.allSessions().filter((session) => session.workspacePath === path));
  }

  dispose(): void {
    for (const detach of [...this.providerDetach.values()]) detach();
    this.providerDetach.clear();
    this.providerSessions.clear();
    this.host.dispose();
  }

  private publish(): void {
    const grouped = groupByWorkspace(this.allSessions());
    const paths = new Set<string>([
      ...grouped.keys(),
      ...this.host.instances().map(([key]) => key.path),
    ]);

    for (const path of paths) {
      const sessions = sortedSessions(grouped.get(path) ?? []);
      const cell = this.cellFor(path);
      cell.states.activity.produce((draft) => {
        draft.sessions = sessions;
      });
    }
  }

  private allSessions(): SessionInfo[] {
    return [...this.providerSessions.values()].flat();
  }

  private cellFor(path: string) {
    const key = { path };
    return (
      this.host.get(key) ??
      this.host.create(key, {
        activity: {
          sessions: [],
        },
      })
    );
  }
}

export function providerFromClient(
  runtime: string,
  client: ActivityProviderClient
): ActivityProvider {
  return {
    runtime,
    attach(onSessions) {
      const replica = createLiveModelReplica(activityProviderContract.activity, client.activity, {
        onChange: {
          sessions: (sessions) => onSessions(normalizeSessions(runtime, sessions as SessionInfo[])),
        },
      });
      const lease = replica.acquire({});
      let disposed = false;
      void lease.ready().then(
        (instance) => {
          if (disposed) return;
          onSessions(normalizeSessions(runtime, instance.states.sessions.current()));
        },
        () => {
          if (!disposed) onSessions([]);
        }
      );
      return () => {
        disposed = true;
        void lease.release();
        void replica.dispose();
        onSessions([]);
      };
    },
  };
}

function normalizeSessions(runtime: string, sessions: SessionInfo[]): SessionInfo[] {
  return sortedSessions(
    sessions.map((session) => ({
      ...session,
      runtime: session.runtime || runtime,
    }))
  );
}

function groupByWorkspace(sessions: SessionInfo[]): Map<string, SessionInfo[]> {
  const grouped = new Map<string, SessionInfo[]>();
  for (const session of sessions) {
    const bucket = grouped.get(session.workspacePath) ?? [];
    bucket.push(session);
    grouped.set(session.workspacePath, bucket);
  }
  return grouped;
}

function sortedSessions(sessions: SessionInfo[]): SessionInfo[] {
  return [...sessions].sort(
    (left, right) =>
      left.workspacePath.localeCompare(right.workspacePath) ||
      left.runtime.localeCompare(right.runtime) ||
      left.sessionId.localeCompare(right.sessionId)
  );
}
