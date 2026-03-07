export type FsListItem = {
  path: string;
  type: 'file' | 'dir';
};

export type FsListWorkerResponse =
  | {
      taskId: number;
      ok: true;
      items: FsListItem[];
      truncated: boolean;
      reason?: 'maxEntries' | 'timeBudget';
      durationMs: number;
    }
  | {
      taskId: number;
      ok: false;
      error: string;
    };
