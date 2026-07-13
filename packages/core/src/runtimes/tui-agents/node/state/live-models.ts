import { createLiveModelHost, type LiveInstance, type LiveModelHost } from '@emdash/wire';
import {
  tuiAgentsContract,
  type TuiNotificationList,
  type TuiSessionList,
} from '@runtimes/tui-agents/api';

export type TuiSessionsLiveHost = LiveModelHost<typeof tuiAgentsContract.sessions>;
export type TuiNotificationsLiveHost = LiveModelHost<typeof tuiAgentsContract.notifications>;
export type TuiSessionsListModel = LiveInstance<typeof tuiAgentsContract.sessions>;
export type TuiNotificationsListModel = LiveInstance<typeof tuiAgentsContract.notifications>;

export function createTuiSessionsLiveHost(): TuiSessionsLiveHost {
  return createLiveModelHost(tuiAgentsContract.sessions);
}

export function createTuiNotificationsLiveHost(): TuiNotificationsLiveHost {
  return createLiveModelHost(tuiAgentsContract.notifications);
}

export function createTuiSessionsListModel(host: TuiSessionsLiveHost): TuiSessionsListModel {
  return host.create(undefined, { list: {} satisfies TuiSessionList });
}

export function createTuiNotificationsListModel(
  host: TuiNotificationsLiveHost
): TuiNotificationsListModel {
  return host.create(undefined, { list: {} satisfies TuiNotificationList });
}
