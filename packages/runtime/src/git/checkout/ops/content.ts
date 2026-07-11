import type { BoundExec } from '@emdash/core/exec';
import { toRefString, type GitFileContentState, type GitFileSource } from '@emdash/core/git';
import type { PortableRelativePath } from '@emdash/core/path';
import { commandFailed, gitFailure, isMissingObject } from '../../exec/errors';
import { checkoutFailures } from '../errors';

const MAX_CONTENT_BYTES = 10 * 1024 * 1024;

export async function readGitFileContent(
  exec: BoundExec,
  path: PortableRelativePath,
  source: GitFileSource
): Promise<GitFileContentState> {
  const spec = sourceSpec(source, path);
  try {
    const { stdout: oidOutput } = await exec.exec([
      'rev-parse',
      '--verify',
      '--end-of-options',
      spec,
    ]);
    const oid = oidOutput.trim();
    const { stdout } = await exec.execBuffer(['cat-file', 'blob', oid], {
      maxBuffer: MAX_CONTENT_BYTES,
    });
    const base = { path, source, oid, byteSize: stdout.length } as const;
    if (stdout.includes(0)) return { kind: 'binary', ...base };
    try {
      return {
        kind: 'text',
        ...base,
        content: new TextDecoder('utf-8', { fatal: true }).decode(stdout),
      };
    } catch {
      return { kind: 'binary', ...base };
    }
  } catch (error) {
    const failure = gitFailure(error);
    if (
      isMissingObject(failure) ||
      (failure.exitCode === 128 &&
        failure.message.toLowerCase().includes('needed a single revision')) ||
      checkoutFailures.isUnknownRevision(error) ||
      (source.kind === 'index' && checkoutFailures.isMissingIndexEntry(error))
    ) {
      return { kind: 'missing', path, source };
    }
    return { kind: 'unavailable', path, source, error: commandFailed(error).error };
  }
}

function sourceSpec(source: GitFileSource, path: PortableRelativePath): string {
  switch (source.kind) {
    case 'head':
      return `HEAD:${path}`;
    case 'index':
      return `:${path}`;
    case 'revision':
      return `${toRefString(source.revision)}:${path}`;
  }
}
