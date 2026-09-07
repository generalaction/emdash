import type { Readable } from '@emdash/wire/state';
import type { HostServerState } from '../contract';

/** Installation and daemon control for one remote Host's workspace server. */
export interface HostWorkspaceServer {
  readonly state: Readable<HostServerState | undefined>;
  refresh(options?: { force?: boolean }): Promise<void>;
  install(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  update(): Promise<void>;
}
