export type StorageScanErrorType = 'not-found' | 'not-directory' | 'read-failed' | 'stat-failed';

export type StorageScanError = {
  type: StorageScanErrorType;
  path: string;
  message: string;
};

export type PathStorageUsage = {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  apparentBytes: number;
  reclaimableBytes: number;
  errors: StorageScanError[];
};
