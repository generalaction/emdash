import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { injectIssueFooter } from './prIssueFooter';

type ExecFileResult = {
  stdout?: string | Buffer;
};

type ExecFileLike = (
  file: string,
  args: string[],
  options: { cwd: string }
) => Promise<ExecFileResult>;

type PatchPrIssueFooterArgs = {
  taskPath: string;
  metadata: unknown;
  execFile: ExecFileLike;
  prUrl?: string | null;
};

export async function patchCurrentPrBodyWithIssueFooter({
  taskPath,
  metadata,
  execFile,
  prUrl,
}: PatchPrIssueFooterArgs): Promise<boolean> {
  const existingBody = await execFile('gh', ['pr', 'view', '--json', 'body', '-q', '.body'], {
    cwd: taskPath,
  });
  const existingBodyText = String(existingBody.stdout || '');
  const mergedBody = injectIssueFooter(existingBodyText, metadata);
  if (!mergedBody) {
    return false;
  }
  if (mergedBody === existingBodyText) {
    return false;
  }

  const bodyFile = path.join(
    os.tmpdir(),
    `gh-pr-edit-body-${Date.now()}-${Math.random().toString(36).substring(7)}.txt`
  );

  try {
    fs.writeFileSync(bodyFile, mergedBody, 'utf8');
    const editArgs = ['pr', 'edit'];
    if (prUrl) {
      editArgs.push(prUrl);
    }
    editArgs.push('--body-file', bodyFile);
    await execFile('gh', editArgs, { cwd: taskPath });
    return true;
  } finally {
    if (fs.existsSync(bodyFile)) {
      try {
        fs.unlinkSync(bodyFile);
      } catch {
        // Ignore cleanup errors; caller should not fail due to temp-file deletion.
      }
    }
  }
}
