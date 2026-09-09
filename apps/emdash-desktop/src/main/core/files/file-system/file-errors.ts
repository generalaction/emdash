import type { FsError } from '@emdash/core/runtimes/files/api';
import { fsErrorMessage } from '@core/services/runtime-broker/node/files';

export function fileErrorToMessage(error: FsError): string {
  return fsErrorMessage(error);
}
