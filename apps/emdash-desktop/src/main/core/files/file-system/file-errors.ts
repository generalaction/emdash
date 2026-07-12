import type { FsError } from '@emdash/core/files';
import { fsErrorMessage } from '../scoped-file-system';

export function fileErrorToMessage(error: FsError): string {
  return fsErrorMessage(error);
}
