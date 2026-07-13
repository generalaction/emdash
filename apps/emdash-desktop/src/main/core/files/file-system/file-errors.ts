import type { FsError } from '@emdash/core/runtimes/files/api';
import { fsErrorMessage } from '../runtime-process/client';

export function fileErrorToMessage(error: FsError): string {
  return fsErrorMessage(error);
}
