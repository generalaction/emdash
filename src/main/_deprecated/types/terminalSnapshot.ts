export interface TerminalSnapshotPayload {
  version: 1;
  createdAt: string;
  cols: number;
  rows: number;
  data: string;
  stats?: Record<string, unknown>;
}

export const TERMINAL_SNAPSHOT_VERSION = 1 as const;
