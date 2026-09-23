import type { PortableRelativePath } from '#primitives/path/api';
import {
  toRefString,
  type Commit,
  type CommitFile,
  type GitLogOptions,
  type GitLogResult,
} from '#runtimes/git/api';
import { checkoutFailures } from '#runtimes/git/node/checkout/errors';
import type { BoundExec } from '#services/exec/api';
import { parseNameStatus, parseNumstat } from './diff-parser';

// Commit messages can contain any byte except NUL, so NUL is the only safe
// delimiter. `%x00` emits a literal NUL between fields and `-z` terminates
// each record with NUL instead of a newline.
const FIELD_SEP = '\x00';
const LOG_FIELD_COUNT = 7;
// `%at` is the author date as unix epoch seconds; the wire carries epoch ms.
export const LOG_FORMAT = '%H%x00%P%x00%s%x00%b%x00%an%x00%at%x00%D';

export async function getLog(exec: BoundExec, options: GitLogOptions = {}): Promise<GitLogResult> {
  const maxCount = typeof options.limit === 'number' ? Math.max(1, Math.floor(options.limit)) : 50;
  const skip = typeof options.skip === 'number' ? Math.max(0, Math.floor(options.skip)) : 0;
  const head = options.head ? toRefString(options.head) : 'HEAD';
  const range = options.base ? `${toRefString(options.base)}..${head}` : head;
  const [{ stdout }, { stdout: countOutput }, remoteReachable] = await Promise.all([
    exec.exec([
      'log',
      `--max-count=${maxCount}`,
      `--skip=${skip}`,
      '--decorate=full',
      `--format=${LOG_FORMAT}`,
      '-z',
      range,
      '--',
    ]),
    exec.exec(['rev-list', '--count', range, '--']),
    getRemoteReachableCommits(exec),
  ]);
  return {
    commits: parseLogRecords(stdout, remoteReachable),
    totalCount: Number.parseInt(countOutput.trim(), 10) || 0,
  };
}

export async function getCommit(exec: BoundExec, hash: string): Promise<Commit | null> {
  try {
    const { stdout } = await exec.exec([
      'log',
      '--max-count=1',
      '--decorate=full',
      `--format=${LOG_FORMAT}`,
      '-z',
      hash,
      '--',
    ]);
    const remoteReachable = await getRemoteReachableCommits(exec);
    return parseLogRecords(stdout, remoteReachable)[0] ?? null;
  } catch (error) {
    if (!checkoutFailures.isUnknownRevision(error)) throw error;
    return null;
  }
}

export async function getCommitFiles(
  exec: BoundExec,
  hash: string,
  toPortablePath: (filePath: string) => PortableRelativePath
): Promise<CommitFile[]> {
  const [numstatRes, nameStatusRes] = await Promise.all([
    exec.exec(['diff-tree', '--root', '--no-commit-id', '--numstat', '-z', '-r', hash]),
    exec.exec(['diff-tree', '--root', '--no-commit-id', '--name-status', '-z', '-r', hash]),
  ]);
  const numstat = parseNumstat(numstatRes.stdout);
  const statusByPath = new Map(parseNameStatus(nameStatusRes.stdout));
  return [...numstat.entries()].map(([filePath, stat]) => ({
    path: toPortablePath(filePath),
    status: statusByPath.get(filePath) ?? 'modified',
    additions: stat.additions,
    deletions: stat.deletions,
  }));
}

export function parseLogRecords(stdout: string, remoteReachable: Set<string>): Commit[] {
  // `-z` terminates the last record too, leaving an empty tail after the split.
  const fields = stdout.split(FIELD_SEP);
  if (fields[fields.length - 1] === '') fields.pop();
  const commits: Commit[] = [];
  for (let i = 0; i + LOG_FIELD_COUNT <= fields.length; i += LOG_FIELD_COUNT) {
    const [hash, parents, subject, body, author, date, decorations] = fields.slice(
      i,
      i + LOG_FIELD_COUNT
    );
    commits.push({
      hash,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      subject,
      body: body.trim(),
      author,
      date: (Number.parseInt(date, 10) || 0) * 1000,
      isPushed: remoteReachable.has(hash),
      tags: parseDecoratedTags(decorations),
    });
  }
  return commits;
}

export function parseDecoratedTags(decorations: string): string[] {
  return decorations
    .split(',')
    .map((decoration) => decoration.trim())
    .filter((decoration) => decoration.startsWith('tag: '))
    .map((decoration) => decoration.slice('tag: '.length).replace(/^refs\/tags\//, ''))
    .filter(Boolean);
}

async function getRemoteReachableCommits(exec: BoundExec): Promise<Set<string>> {
  const { stdout } = await exec.exec(['rev-list', '--remotes', '--max-count=10000']);
  return new Set(
    stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  );
}
