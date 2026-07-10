import type { BoundExec } from '@emdash/core/exec';
import type { GitHeadModel } from '@emdash/core/git';

/** Throws when the path is not a git repository; callers keep the previous model. */
export async function computeHeadModel(exec: BoundExec): Promise<GitHeadModel> {
  try {
    const { stdout } = await exec.exec(['symbolic-ref', '--short', 'HEAD']);
    const name = stdout.trim();
    try {
      const { stdout: oid } = await exec.exec(['rev-parse', '--verify', 'HEAD']);
      return { kind: 'branch', name, oid: oid.trim() };
    } catch {
      return { kind: 'unborn', name };
    }
  } catch {
    const [short, oid] = await Promise.all([
      exec.exec(['rev-parse', '--short', 'HEAD']),
      exec.exec(['rev-parse', '--verify', 'HEAD']),
    ]);
    return { kind: 'detached', shortHash: short.stdout.trim(), oid: oid.stdout.trim() };
  }
}
