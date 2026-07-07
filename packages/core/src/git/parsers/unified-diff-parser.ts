import type { DiffHunk, DiffLine, FileDiff } from '../api/queries';

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parses `git diff` unified output for a single file into a FileDiff.
 * Expects output produced with `--no-color`; multi-file output is not supported.
 */
export function parseUnifiedFileDiff(output: string, filePath: string): FileDiff {
  const diff: FileDiff = {
    path: filePath,
    binary: false,
    additions: 0,
    deletions: 0,
    hunks: [],
  };

  let hunk: DiffHunk | null = null;
  let oldLineNo = 0;
  let newLineNo = 0;

  for (const line of output.split('\n')) {
    if (line.startsWith('Binary files ') && line.endsWith(' differ')) {
      diff.binary = true;
      continue;
    }
    if (line.startsWith('index ')) {
      // "index <oldOid>..<newOid>[ <mode>]"
      const spec = line.slice('index '.length).split(' ')[0] ?? '';
      const [oldOid, newOid] = spec.split('..');
      if (oldOid && !/^0+$/.test(oldOid)) diff.oldOid = oldOid;
      if (newOid && !/^0+$/.test(newOid)) diff.newOid = newOid;
      continue;
    }

    const header = HUNK_HEADER_RE.exec(line);
    if (header) {
      const oldStart = Number.parseInt(header[1] ?? '0', 10);
      const oldLines = header[2] !== undefined ? Number.parseInt(header[2], 10) : 1;
      const newStart = Number.parseInt(header[3] ?? '0', 10);
      const newLines = header[4] !== undefined ? Number.parseInt(header[4], 10) : 1;
      hunk = { header: line, oldStart, oldLines, newStart, newLines, lines: [] };
      diff.hunks.push(hunk);
      oldLineNo = oldStart;
      newLineNo = newStart;
      continue;
    }

    if (!hunk) continue;

    const marker = line.charAt(0);
    const content = line.slice(1);
    let diffLine: DiffLine | null = null;
    switch (marker) {
      case '+':
        diffLine = { type: 'add', content, newLineNo };
        newLineNo += 1;
        diff.additions += 1;
        break;
      case '-':
        diffLine = { type: 'del', content, oldLineNo };
        oldLineNo += 1;
        diff.deletions += 1;
        break;
      case ' ':
        diffLine = { type: 'context', content, oldLineNo, newLineNo };
        oldLineNo += 1;
        newLineNo += 1;
        break;
      case '\\':
        diffLine = { type: 'no-newline', content: line };
        break;
      default:
        // Any other line (e.g. "diff --git", mode headers) ends the current hunk.
        hunk = null;
        break;
    }
    if (diffLine) hunk?.lines.push(diffLine);
  }

  return diff;
}
