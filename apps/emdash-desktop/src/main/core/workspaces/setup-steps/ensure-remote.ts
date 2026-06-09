import type * as Step from '@shared/core/workspaces/workspace-setup-steps/ensure-remote';
import { err, ok, type Result } from '@shared/lib/result';
import type { StepContext } from './step-context';

export async function execute(
  args: Step.Args,
  ctx: StepContext
): Promise<Result<Step.Success, Step.Error>> {
  const { name, url } = args;
  try {
    const { stdout } = await ctx.ctx.exec('git', ['remote']).catch(() => ({ stdout: '' }));
    const existing = stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!existing.includes(name)) {
      await ctx.ctx.exec('git', ['remote', 'add', name, url]);
    } else {
      // Idempotently update URL in case it changed (e.g. fork URL updated).
      await ctx.ctx.exec('git', ['remote', 'set-url', name, url]).catch(() => {});
    }
    return ok({});
  } catch (error: unknown) {
    const message = (error as { stderr?: string })?.stderr ?? String(error);
    return err({ type: 'remote-error', name, message });
  }
}
