import type { FileSearchStore } from '@runtimes/file-search/node/store';

/** Injectable constructor for the single-process database-backed store. */
export type OpenFileSearchDatabase = (databasePath: string) => FileSearchStore;
