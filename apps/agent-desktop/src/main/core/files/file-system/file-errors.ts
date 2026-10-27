import type { FsError } from '@agent/core/runtimes/files/api';
import { fsErrorMessage } from '@core/services/runtime-broker/node/files';

export function fileErrorToMessage(error: FsError): string {
  return fsErrorMessage(error);
}
